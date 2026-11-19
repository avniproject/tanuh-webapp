.PHONY: help deps clean clean-cache start start-with-staging start-with-prerelease start-with-prod build build-app preview typecheck lint test deploy-staging deploy-uat

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

deploy-staging: ## Deploy REF to staging-tanuh.avniproject.org (Tanuh staging account)
	@test -n "$(REF)" || { echo "usage: make deploy-staging REF=<branch, tag or commit>"; exit 1; }
	deploy/deploy.sh staging $(REF)

deploy-uat: ## Deploy the open minor branch, or REF, to uat-tanuh.avniproject.org
	deploy/deploy.sh uat $(REF)

lint: ## Run ESLint
	npm run lint

test: typecheck lint ## Run the unit tests, plus typecheck and lint
	npm test
