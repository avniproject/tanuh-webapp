.PHONY: help deps clean clean-cache start start-with-staging start-with-prerelease start-with-prod build build-app preview typecheck lint test

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-26s %s\n", $$1, $$2}'

deps: ## Install npm dependencies
	npm install

clean: ## Remove build output and node_modules
	rm -rf node_modules dist tsconfig.tsbuildinfo

clean-cache: ## Clear Vite cache only
	rm -rf node_modules/.vite

start: ## Run dev server (reads .env)
	npm run dev

start-with-staging: ## Run dev server pointed at staging
	VITE_AVNI_PROXY_TARGET=https://staging.avniproject.org npm run dev

start-with-prerelease: ## Run dev server pointed at prerelease
	VITE_AVNI_PROXY_TARGET=https://prerelease.avniproject.org npm run dev

start-with-prod: ## Run dev server pointed at production (uses Vite proxy to bypass CORS)
	VITE_AVNI_PROXY_TARGET=https://app.avniproject.org npm run dev

build: build-app ## Build production bundle into dist/

build-app: ## Run vite build
	npm run build

preview: ## Serve the production bundle locally
	npm run preview

typecheck: ## Run TypeScript type-check
	npm run typecheck

lint: ## Run ESLint
	npm run lint

test: typecheck build ## Typecheck + build (no test suite yet)
