#include <llama.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <ctype.h>
#include <limits.h>
#ifdef _WIN32
#include <windows.h>
#include <BaseTsd.h>
typedef SSIZE_T ssize_t;
#else
#include <unistd.h>
#endif

// Minimal JSMN JSON parser (public domain)
typedef enum {
    JSMN_UNDEFINED = 0,
    JSMN_OBJECT = 1,
    JSMN_ARRAY = 2,
    JSMN_STRING = 3,
    JSMN_PRIMITIVE = 4
} jsmntype_t;

typedef struct {
    jsmntype_t type;
    int start;
    int end;
    int size;
    int parent;
} jsmntok_t;

typedef struct {
    unsigned int pos;
    unsigned int toknext;
    int toksuper;
} jsmn_parser;

enum {
    JSMN_ERROR_NOMEM = -1,
    JSMN_ERROR_INVAL = -2,
    JSMN_ERROR_PART = -3
};

static void jsmn_init(jsmn_parser *parser) {
    parser->pos = 0;
    parser->toknext = 0;
    parser->toksuper = -1;
}

static jsmntok_t *jsmn_alloc_token(jsmn_parser *parser, jsmntok_t *tokens, size_t num_tokens) {
    if (parser->toknext >= num_tokens) return NULL;
    jsmntok_t *tok = &tokens[parser->toknext++];
    tok->start = tok->end = -1;
    tok->size = 0;
    tok->parent = -1;
    tok->type = JSMN_UNDEFINED;
    return tok;
}

static void jsmn_fill_token(jsmntok_t *token, jsmntype_t type, int start, int end) {
    token->type = type;
    token->start = start;
    token->end = end;
    token->size = 0;
}

static int jsmn_parse_primitive(jsmn_parser *parser, const char *js, size_t len,
                                jsmntok_t *tokens, size_t num_tokens) {
    int start = parser->pos;
    for (; parser->pos < len; parser->pos++) {
        char c = js[parser->pos];
        if (c == '\t' || c == '\r' || c == '\n' || c == ' ' || c == ',' || c == ']' || c == '}') {
            jsmntok_t *tok = jsmn_alloc_token(parser, tokens, num_tokens);
            if (!tok) return JSMN_ERROR_NOMEM;
            jsmn_fill_token(tok, JSMN_PRIMITIVE, start, parser->pos);
            tok->parent = parser->toksuper;
            parser->pos--;
            return 0;
        }
    }
    jsmntok_t *tok = jsmn_alloc_token(parser, tokens, num_tokens);
    if (!tok) return JSMN_ERROR_NOMEM;
    jsmn_fill_token(tok, JSMN_PRIMITIVE, start, parser->pos);
    tok->parent = parser->toksuper;
    parser->pos--;
    return 0;
}

static int jsmn_parse_string(jsmn_parser *parser, const char *js, size_t len,
                             jsmntok_t *tokens, size_t num_tokens) {
    int start = parser->pos;
    parser->pos++;
    for (; parser->pos < len; parser->pos++) {
        char c = js[parser->pos];
        if (c == '"') {
            jsmntok_t *tok = jsmn_alloc_token(parser, tokens, num_tokens);
            if (!tok) return JSMN_ERROR_NOMEM;
            jsmn_fill_token(tok, JSMN_STRING, start + 1, parser->pos);
            tok->parent = parser->toksuper;
            return 0;
        }
        if (c == '\\' && parser->pos + 1 < len) {
            parser->pos++;
            continue;
        }
    }
    return JSMN_ERROR_PART;
}

static int jsmn_parse(jsmn_parser *parser, const char *js, size_t len,
                      jsmntok_t *tokens, unsigned int num_tokens) {
    int r;
    for (; parser->pos < len; parser->pos++) {
        char c = js[parser->pos];
        switch (c) {
            case '{':
            case '[': {
                jsmntok_t *tok = jsmn_alloc_token(parser, tokens, num_tokens);
                if (!tok) return JSMN_ERROR_NOMEM;
                tok->type = (c == '{' ? JSMN_OBJECT : JSMN_ARRAY);
                tok->start = parser->pos;
                tok->parent = parser->toksuper;
                if (parser->toksuper != -1) tokens[parser->toksuper].size++;
                parser->toksuper = parser->toknext - 1;
                break;
            }
            case '}':
            case ']': {
                jsmntype_t type = (c == '}' ? JSMN_OBJECT : JSMN_ARRAY);
                int i;
                for (i = parser->toknext - 1; i >= 0; i--) {
                    if (tokens[i].start != -1 && tokens[i].end == -1) {
                        if (tokens[i].type != type) return JSMN_ERROR_INVAL;
                        tokens[i].end = parser->pos + 1;
                        parser->toksuper = tokens[i].parent;
                        break;
                    }
                }
                if (i == -1) return JSMN_ERROR_INVAL;
                break;
            }
            case '"':
                r = jsmn_parse_string(parser, js, len, tokens, num_tokens);
                if (r < 0) return r;
                if (parser->toksuper != -1) tokens[parser->toksuper].size++;
                break;
            case '\t':
            case '\r':
            case '\n':
            case ' ':
            case ':':
            case ',':
                break;
            default:
                r = jsmn_parse_primitive(parser, js, len, tokens, num_tokens);
                if (r < 0) return r;
                if (parser->toksuper != -1) tokens[parser->toksuper].size++;
                break;
        }
    }
    for (unsigned int i = parser->toknext - 1; i < parser->toknext; i--) {
        if (tokens[i].start != -1 && tokens[i].end == -1) return JSMN_ERROR_PART;
        if (i == 0) break;
    }
    return parser->toknext;
}

static void die(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    fprintf(stderr, "\n");
    va_end(ap);
}

static int json_eq(const char *json, jsmntok_t *tok, const char *s) {
    int len = tok->end - tok->start;
    return (tok->type == JSMN_STRING && (int)strlen(s) == len && strncmp(json + tok->start, s, (size_t)len) == 0);
}

static int jsmn_skip(const jsmntok_t *toks, int index) {
    int i, j;
    if (toks[index].type == JSMN_STRING || toks[index].type == JSMN_PRIMITIVE) return index + 1;
    if (toks[index].type == JSMN_ARRAY) {
        j = index + 1;
        for (i = 0; i < toks[index].size; i++) {
            j = jsmn_skip(toks, j);
        }
        return j;
    }
    if (toks[index].type == JSMN_OBJECT) {
        j = index + 1;
        for (i = 0; i < toks[index].size; i++) {
            j = jsmn_skip(toks, j); // key
            j = jsmn_skip(toks, j); // value
        }
        return j;
    }
    return index + 1;
}

static int json_find_key(const char *json, jsmntok_t *toks, int obj_index, const char *key) {
    if (toks[obj_index].type != JSMN_OBJECT) return -1;
    int count = toks[obj_index].size;
    int i = obj_index + 1;
    for (int j = 0; j < count; j++) {
        if (json_eq(json, &toks[i], key)) {
            return i + 1;
        }
        i = jsmn_skip(toks, i + 1);
    }
    return -1;
}

static char *json_strdup(const char *json, jsmntok_t *tok) {
    int len = tok->end - tok->start;
    char *s = (char *)malloc((size_t)len + 1);
    if (!s) return NULL;
    memcpy(s, json + tok->start, (size_t)len);
    s[len] = '\0';
    return s;
}

static int json_toint(const char *json, jsmntok_t *tok) {
    int len = tok->end - tok->start;
    char tmp[64];
    if (len <= 0) return 0;
    if (len >= (int)sizeof(tmp)) len = (int)sizeof(tmp) - 1;
    memcpy(tmp, json + tok->start, (size_t)len);
    tmp[len] = '\0';
    return atoi(tmp);
}

static int parse_request(const char *json, size_t len, int *out_id, char **out_type, char **out_prompt, int *out_max_tokens) {
    jsmn_parser parser;
    int tokcount = 128;
    jsmntok_t *toks = NULL;
    int ret = 0;

    while (1) {
        jsmn_init(&parser);
        toks = (jsmntok_t *)realloc(toks, (size_t)tokcount * sizeof(jsmntok_t));
        if (!toks) return -1;
        memset(toks, 0, (size_t)tokcount * sizeof(jsmntok_t));
        ret = jsmn_parse(&parser, json, len, toks, (unsigned int)tokcount);
        if (ret == JSMN_ERROR_NOMEM) {
            tokcount *= 2;
            continue;
        }
        if (ret < 1) { free(toks); return -1; }
        break;
    }

    if (toks[0].type != JSMN_OBJECT) { free(toks); return -1; }

    int id_tok = json_find_key(json, toks, 0, "id");
    int type_tok = json_find_key(json, toks, 0, "type");
    int prompt_tok = json_find_key(json, toks, 0, "prompt");
    int max_tok = json_find_key(json, toks, 0, "max_tokens");

    if (id_tok >= 0) *out_id = json_toint(json, &toks[id_tok]);
    if (type_tok >= 0) *out_type = json_strdup(json, &toks[type_tok]);
    if (prompt_tok >= 0) *out_prompt = json_strdup(json, &toks[prompt_tok]);
    if (max_tok >= 0 && out_max_tokens) *out_max_tokens = json_toint(json, &toks[max_tok]);

    free(toks);
    return 0;
}

static void json_escape(const char *s, FILE *out) {
    for (const unsigned char *p = (const unsigned char *)s; p && *p; p++) {
        unsigned char c = *p;
        switch (c) {
            case '"': fputs("\\\"", out); break;
            case '\\': fputs("\\\\", out); break;
            case '\n': fputs("\\n", out); break;
            case '\r': fputs("\\r", out); break;
            case '\t': fputs("\\t", out); break;
            default:
                if (c < 0x20) {
                    fprintf(out, "\\u%04x", c);
                } else {
                    fputc(c, out);
                }
        }
    }
}

static ssize_t read_line(char **lineptr, size_t *n, FILE *stream) {
    if (!lineptr || !n || !stream) return -1;
    if (*lineptr == NULL || *n == 0) {
        *n = 1024;
        *lineptr = (char *)malloc(*n);
        if (!*lineptr) return -1;
    }

    size_t pos = 0;
    int ch;
    while ((ch = fgetc(stream)) != EOF) {
        if (pos + 1 >= *n) {
            size_t newn = (*n) * 2;
            char *tmp = (char *)realloc(*lineptr, newn);
            if (!tmp) return -1;
            *lineptr = tmp;
            *n = newn;
        }
        (*lineptr)[pos++] = (char)ch;
        if (ch == '\n') break;
    }
    if (pos == 0 && ch == EOF) return -1;
    (*lineptr)[pos] = '\0';
    return (ssize_t)pos;
}

static int get_cpu_count(void) {
#ifdef _WIN32
    SYSTEM_INFO si;
    GetSystemInfo(&si);
    if (si.dwNumberOfProcessors < 1) return 4;
    if (si.dwNumberOfProcessors > INT_MAX) return INT_MAX;
    return (int)si.dwNumberOfProcessors;
#else
    long n = sysconf(_SC_NPROCESSORS_ONLN);
    if (n < 1) return 4;
    if (n > INT_MAX) n = INT_MAX;
    return (int)n;
#endif
}

static int argmax(const float *logits, int n_vocab) {
    int best = 0;
    float max = logits[0];
    for (int i = 1; i < n_vocab; i++) {
        if (logits[i] > max) {
            max = logits[i];
            best = i;
        }
    }
    return best;
}

static char *detokenize(const struct llama_vocab *vocab, const int *tokens, int n_tokens) {
    size_t cap = 256;
    size_t len = 0;
    char *out = (char *)malloc(cap);
    if (!out) return NULL;
    out[0] = '\0';

    for (int i = 0; i < n_tokens; i++) {
        int buf_size = 256;
        char *buf = (char *)malloc((size_t)buf_size);
        if (!buf) continue;
        int n = llama_token_to_piece(vocab, tokens[i], buf, buf_size, 0, false);
        if (n < 0) {
            free(buf);
            continue;
        }
        if (n >= buf_size) {
            free(buf);
            buf_size = n + 1;
            buf = (char *)malloc((size_t)buf_size);
            if (!buf) continue;
            n = llama_token_to_piece(vocab, tokens[i], buf, buf_size, 0, false);
            if (n < 0) { free(buf); continue; }
        }

        if (len + (size_t)n + 1 > cap) {
            cap = (len + (size_t)n + 1) * 2;
            char *tmp = (char *)realloc(out, cap);
            if (!tmp) { free(buf); break; }
            out = tmp;
        }
        memcpy(out + len, buf, (size_t)n);
        len += (size_t)n;
        out[len] = '\0';
        free(buf);
    }

    return out;
}

static char *translate_prompt(struct llama_context *ctx, struct llama_model *model, const char *prompt, int max_tokens) {
    const struct llama_vocab *vocab = llama_model_get_vocab(model);
    int n_vocab = llama_vocab_n_tokens(vocab);
    llama_memory_t mem = llama_get_memory(ctx);
    if (mem) {
        llama_memory_clear(mem, true);
    }

    int max_input_tokens = 4096;
    llama_token *tokens = (llama_token *)malloc((size_t)max_input_tokens * sizeof(llama_token));
    if (!tokens) return NULL;

    int n_tokens = llama_tokenize(vocab, prompt, (int)strlen(prompt), tokens, max_input_tokens, true, false);
    if (n_tokens < 0) {
        free(tokens);
        return NULL;
    }

    struct llama_batch batch = llama_batch_init(n_tokens, 0, 1);
    batch.n_tokens = n_tokens;
    for (int i = 0; i < n_tokens; i++) {
        batch.token[i] = tokens[i];
        batch.pos[i] = i;
        batch.n_seq_id[i] = 1;
        batch.seq_id[i][0] = 0;
        batch.logits[i] = (i == n_tokens - 1) ? 1 : 0;
    }

    int res = llama_decode(ctx, batch);
    llama_batch_free(batch);
    if (res != 0) {
        free(tokens);
        return NULL;
    }

    int eos = llama_vocab_eos(vocab);
    int n_cur = n_tokens;
    int out_cap = 256;
    int out_len = 0;
    int *out_tokens = (int *)malloc((size_t)out_cap * sizeof(int));
    if (!out_tokens) { free(tokens); return NULL; }

    for (int i = 0; i < max_tokens; i++) {
        float *logits = llama_get_logits(ctx);
        int new_tok = argmax(logits, n_vocab);
        if (new_tok == eos) break;

        if (out_len >= out_cap) {
            out_cap *= 2;
            int *tmp = (int *)realloc(out_tokens, (size_t)out_cap * sizeof(int));
            if (!tmp) break;
            out_tokens = tmp;
        }
        out_tokens[out_len++] = new_tok;

        struct llama_batch one = llama_batch_init(1, 0, 1);
        one.n_tokens = 1;
        one.token[0] = new_tok;
        one.pos[0] = n_cur;
        one.n_seq_id[0] = 1;
        one.seq_id[0][0] = 0;
        one.logits[0] = 1;
        res = llama_decode(ctx, one);
        llama_batch_free(one);
        if (res != 0) break;
        n_cur++;
    }

    char *text = detokenize(vocab, out_tokens, out_len);
    free(out_tokens);
    free(tokens);
    return text;
}

static void usage() {
    fprintf(stderr, "Usage: llama-helper --server --model <path> [--context <n>] [--max-tokens <n>]\n");
}

int main(int argc, char **argv) {
    const char *model_path = NULL;
    int context_size = 4096;
    int max_tokens = 2048;
    int server = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--model") == 0 && i + 1 < argc) { model_path = argv[++i]; continue; }
        if (strcmp(argv[i], "--context") == 0 && i + 1 < argc) { context_size = atoi(argv[++i]); continue; }
        if (strcmp(argv[i], "--max-tokens") == 0 && i + 1 < argc) { max_tokens = atoi(argv[++i]); continue; }
        if (strcmp(argv[i], "--server") == 0) { server = 1; continue; }
    }

    if (!server || !model_path) {
        usage();
        return 1;
    }

    llama_backend_init();

    struct llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = -1;
    mparams.main_gpu = 0;

    struct llama_model *model = llama_load_model_from_file(model_path, mparams);
    if (!model) {
        die("Failed to load model");
        return 1;
    }

    if (context_size <= 0) {
        int n_train = llama_model_n_ctx_train(model);
        if (n_train > 0) {
            context_size = n_train;
        } else {
            context_size = 4096;
        }
    }

    struct llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx = (uint32_t)context_size;
    uint32_t batch = cparams.n_ctx;
    if (batch > 4096) batch = 4096;
    if (batch < 128) batch = 128;
    cparams.n_batch = batch;
    cparams.n_ubatch = batch;
    cparams.offload_kqv = true;
    cparams.op_offload = true;
    int n_threads = get_cpu_count();
    cparams.n_threads = n_threads;
    cparams.n_threads_batch = n_threads;
    struct llama_context *ctx = llama_new_context_with_model(model, cparams);
    if (!ctx) {
        die("Failed to create context");
        llama_free_model(model);
        return 1;
    }
    llama_set_n_threads(ctx, cparams.n_threads, cparams.n_threads_batch);

    char *line = NULL;
    size_t linecap = 0;
    ssize_t linelen;

    while ((linelen = read_line(&line, &linecap, stdin)) > 0) {
        if (linelen <= 1) continue;
        if (line[linelen - 1] == '\n') line[linelen - 1] = '\0';

        int id = 0;
        char *type = NULL;
        char *prompt = NULL;
        int req_max_tokens = 0;
        if (parse_request(line, (size_t)strlen(line), &id, &type, &prompt, &req_max_tokens) != 0) {
            fprintf(stdout, "{\"id\":%d,\"ok\":false,\"error\":\"invalid request\"}\n", id);
            fflush(stdout);
            free(type);
            free(prompt);
            continue;
        }

        if (type && strcmp(type, "shutdown") == 0) {
            fprintf(stdout, "{\"id\":%d,\"ok\":true}\n", id);
            fflush(stdout);
            free(type);
            free(prompt);
            break;
        }

        if (!type || strcmp(type, "translate") != 0 || !prompt) {
            fprintf(stdout, "{\"id\":%d,\"ok\":false,\"error\":\"missing prompt\"}\n", id);
            fflush(stdout);
            free(type);
            free(prompt);
            continue;
        }

        int use_max_tokens = req_max_tokens > 0 ? req_max_tokens : max_tokens;
        char *result = translate_prompt(ctx, model, prompt, use_max_tokens);
        if (!result) {
            fprintf(stdout, "{\"id\":%d,\"ok\":false,\"error\":\"translation failed\"}\n", id);
        } else {
            fprintf(stdout, "{\"id\":%d,\"ok\":true,\"text\":\"", id);
            json_escape(result, stdout);
            fprintf(stdout, "\"}\n");
            free(result);
        }
        fflush(stdout);
        free(type);
        free(prompt);
    }

    free(line);
    llama_free(ctx);
    llama_free_model(model);
    llama_backend_free();
    return 0;
}
