.PHONY: check verify build evaluate-tools

check:
	python3 scripts/check-project.py

verify:
	python3 scripts/check-project.py --all

build:
	docker compose build pi-agent pi-telegram

# Explicitly loads Qwen; never part of offline verification or CI.
evaluate-tools:
	docker run --rm --tmpfs /tmp --tmpfs /workspace:mode=1777 \
	  -e RIBO_TEST_ISOLATED=1 -e RIBO_TOOL_EVAL=1 \
	  -e RIBO_INTERNAL_TOKEN=synthetic-test-token-0000000000000000000000 \
	  -e RIBO_WEB_PASSWORD=synthetic-test-password-0000 \
	  -e LLM_PROVIDER=ollama -e PI_MODEL=qwen3.8-27b-64k:latest \
	  -e OLLAMA_HOST=http://host.docker.internal:11434 \
	  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
	  -e OLLAMA_CONTEXT_LENGTH=65536 -e TZ=Europe/Berlin \
	  -v "$(CURDIR)/scripts/evaluate-tools.mjs:/app/evaluate-tools.mjs:ro" \
	  --entrypoint node pi-agent-pi-agent:latest /app/evaluate-tools.mjs
