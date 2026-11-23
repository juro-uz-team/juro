# Lex.uz corpus maintenance

The maintenance process reconciles the four publisher inventories and retains new captures separately from the frozen corpus. It preserves exact signed publisher IDs, edition tokens, source observation times, classification provenance and OCR coverage. For first launch it compares the full inventory and each retained source checkpoint, including the boundary day. Later runs check new and changed records daily and revisit the oldest checked portion of the catalogue, with a seven-day target.

Prepare a Python 3.12 environment using `scripts/lexuz_acquisition/requirements.txt` and `scripts/corpus_search/requirements.txt`. Install the platform Node dependencies. Provision the hash-pinned model files listed in `scripts/lexuz_acquisition/media.py`, the verified Uzbek Cyrillic Tesseract model and the pinned Tesseract binary. CPU OCR uses ONNX Runtime. CUDA workers use the corresponding GPU build of ONNX Runtime with the same model hashes. Keep the acquisition directory and the embedding cache on durable storage.

Install the maintenance service and timer from `deploy/` in the dedicated corpus operator's `~/.config/systemd/user/`. Put the checkout and virtual environment at `~/.local/share/juro-corpus/current` and `~/.local/share/juro-corpus/venv`, and put the configuration and private environment at `~/.config/juro-corpus/maintenance.json` and `~/.config/juro-corpus/maintenance.env`. Use a systemd drop-in if the host provisions these paths elsewhere. Enable linger for the operator so the timer and retained source listeners start after a reboot. Once the configuration is ready, run `systemctl --user daemon-reload`, `systemctl --user enable --now juro-lexuz-corpus-maintenance.timer`, and `systemctl --user start juro-lexuz-corpus-maintenance.service` to begin the first catch-up. The timer runs daily at midnight in Asia/Tashkent and recovers missed runs. The command resumes its current acquisition, reuses completed work by exact hashes, and builds an immutable addition beside the currently serving corpus.

| Field | Value |
| --- | --- |
| `root` | Durable acquisition journal, captures, embedding cache and release output |
| `baseline.path`, `baseline.sha256` | Directory and manifest pin of the serving prepared base package |
| `baseVectors.path`, `baseVectors.sha256` | Directory and completion pin of the existing 3,072-dimensional vector pool |
| `baseVectors.identitiesPath`, `baseVectors.identitiesSha256` | Existing exact compact-input identity index and its manifest pin |
| `ocr.models`, `ocr.tessdata`, `ocr.tesseract`, `ocr.device` | Qualified OCR files and execution device |
| `dailyNewInputTokens` | Daily token budget for inputs without an exact compatible vector |
| `releaseTemplate` | Absolute path to a JSON object containing the current and history pinned release configurations |
| `readerRole` | Restricted PostgreSQL navigation reader |
| `serving.workerEnvironment`, `serving.runtimeConfig` | Restricted operator environment file and active answer-runtime configuration. Omit `serving` for a build-only environment. |

Provide the existing provider credential through the private service environment. The builder connects with `JURO_PREPARED_BUILD_DATABASE_URL`. The serving workers use `JURO_PREPARED_DATABASE_URL` and `JURO_PREPARED_TRANSPORT_TOKEN`. Activation uses the application's existing configuration and `PREPARED_TRANSPORT_TOKEN`, which must authenticate to the new workers. Keep credentials out of the maintenance JSON and the generated worker manifests.

Apply the application migration before enabling `LEGAL_CORPUS_MAINTENANCE_JOURNAL` on the platform jobs service. Point it to the absolute path of `maintenance.sqlite`. Apply the corpus publication source migration to the shared corpus database when application and corpus storage use separate databases. The application imports the journal transactionally, with one in-app summary after the first catch-up release has activated and accounted for outstanding material. Individual notices begin with subsequent discoveries. Monitoring labels its catalogue check time separately from when readers can open a prepared edition.

The existing base source reader also needs a catalogue projection. Build it once from the serving package with `python scripts/corpus_search/source_browser.py PACKAGE PACKAGE_SHA256 CATALOG.sqlite`. Add `browserCatalog` with the absolute catalogue path and output SHA-256 to a new source worker manifest. Verify the worker's browse and source reads, then use the new manifest pin in the application configuration.

With serving enabled, the nightly command starts the immutable workers on loopback, checks sparse and dense retrieval and retained source reads, registers the evidence generation, then switches the runtime configuration. Keep the previously configured source workers and their immutable packages available so earlier saved citations can reopen. Numeric workers for superseded additions can be stopped after requests using the earlier configuration finish.

The activation step records a qualification receipt and retains the previous answer-runtime configuration by hash. If a serving health check fails after selection, atomically restore that configuration and verify both previous search endpoints and their source reader. Keep already registered evidence generations and source listeners available for citations. Grant the application corpus reader SELECT on `storage.corpus_publication_sources` and keep corpus registration writes with the operator.

Use `maintenance.json` and the journal to inspect inventory progress and overdue checks. `ready-for-qualification.json` identifies a built release. `activated.json` identifies a selected one. The nightly process revisits failed material in its original acquisition directory so a recovered attachment can complete an existing edition. Material with missing or unverified text stays in the publisher feed with its official link while it awaits preparation. Publisher history can recover editions that Lex.uz still exposes. A silent edit withdrawn before any retained observation remains an unresolved coverage gap.
