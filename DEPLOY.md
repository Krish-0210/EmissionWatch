# Deploy (AWS, ap-south-1)

Everything uses the `emissionwatch` profile. Run from Git Bash in the repo root unless noted.
Nothing has been deployed yet; `cdk synth` and all tests pass.

**Briefs default to template mode.** The Lambda's `BRIEF_MODE` (CDK context `brief_mode`) is `template` unless
you choose otherwise: `POST /brief/{id}` never calls Bedrock and returns the deterministic template brief with
`"source": "auto"` (the site labels it "Auto-generated brief"). Bedrock model access is then not needed.
Deploy with `-c brief_mode=bedrock` to use Bedrock (falls back to the template, `"source": "template"`, on any error).

## 0. Prerequisites (once)
```bash
aws sts get-caller-identity --profile emissionwatch          # note the account id
cdk --version                                                # 2.1145.0 installed globally
```
Only for `brief_mode=bedrock`: in the console (ap-south-1) open **Bedrock → Model access** and make sure
**Anthropic Claude Haiku 4.5** is enabled (Anthropic models need the one-time use-case form).
Check the inference profile exists:
```bash
aws bedrock list-inference-profiles --region ap-south-1 --profile emissionwatch \
  --query "inferenceProfileSummaries[?inferenceProfileId=='in.anthropic.claude-haiku-4-5-20251001-v1:0'].status"
```
In bedrock mode, if Bedrock fails for any reason the API still answers with the template brief (`"source": "template"`).

## 1. Fresh data export (optional)
```bash
cd pipeline && .venv/Scripts/python.exe -m src.export.to_json && cd ..
```
The exporter also needs `pipeline/data/processed/population_20km.csv` (`python -m src.ingest.population`, Earth
Engine, ~1 min) and the committed `pipeline/config/india_towns_50k.csv` (rebuild only with
`python -m src.ingest.towns` after downloading GeoNames `cities15000.zip` + `admin1CodesASCII.txt` into
`pipeline/data/raw/geonames/` and unzipping). It writes `wind_{id}.json` too.
The exporter writes the same JSON to `pipeline/data/export/` (gitignored) and `frontend/public/data/` (committed).
The stack uploads `frontend/public/data/*.json` (the files the local site reads), so the API serves exactly what
local development serves; synth fails if `clusters.json` is missing. Commit the re-exported files before deploying.

## 2. Bootstrap and deploy
```bash
cd infra
source .venv/Scripts/activate
ACCOUNT=$(aws sts get-caller-identity --profile emissionwatch --query Account --output text)
cdk bootstrap aws://$ACCOUNT/ap-south-1 --profile emissionwatch
cdk deploy EmissionWatchStack --profile emissionwatch                          # briefs: template mode
# or: cdk deploy EmissionWatchStack --profile emissionwatch -c brief_mode=bedrock
```
Context values are not remembered between deploys: repeat `-c brief_mode=bedrock` on every later deploy (step 6
too), or set `"brief_mode": "bedrock"` under `context` in `infra/cdk.json`. A deploy without it switches back to
template mode. (For a quick test without redeploying, `BRIEF_MODE` can also be edited on the function in the Lambda
console; the role may call Bedrock in both modes. The next deploy overwrites it.)
Outputs: `ApiUrl` (e.g. `https://abc123.execute-api.ap-south-1.amazonaws.com`) and `BucketName`.
Put them in `.env`: `S3_BUCKET_NAME=<BucketName>`, `BEDROCK_MODEL_ID=in.anthropic.claude-haiku-4-5-20251001-v1:0`.

## 3. Smoke test
```bash
API=<ApiUrl>
curl -s $API/clusters | head -c 300; echo
curl -s $API/clusters/talcher | head -c 200; echo
curl -s $API/clusters/talcher/timeseries | head -c 200; echo
curl -s $API/summary | head -c 200; echo
curl -s -o /dev/null -w "%{http_code}\n" $API/clusters/atlantis        # 404
curl -s -X POST $API/brief/talcher | head -c 400; echo                 # template mode: "source": "auto"
                                                                       # bedrock mode: "bedrock" (or "template")
curl -s $API/clusters/korba/wind | head -c 400; echo                   # "source": "live" (or "era5" if Open-Meteo failed)
curl -s -X POST $API/rti/singrauli | head -c 300; echo                 # {"markdown": "# Draft RTI application: ...", "plain_text": ...}
curl -s $API/plants | head -c 300; echo                                # {"boundaries": ..., "plants": [ ... (166 plants)
curl -s $API/states | head -c 300; echo                                # {"boundaries": ..., "states": [ ... (36 states / UTs)
```
`GET /clusters/{id}/wind` calls `https://api.open-meteo.com` from the Lambda (no key; the function is not in a VPC,
so it has outbound internet by default). If that fails it answers from ERA5 (`"source": "era5"`, logged as
"live forecast failed"). Open-Meteo's free API is for non-commercial use; answers are cached 30 min per cluster.
Logs: `aws logs tail /aws/lambda/<function name> --follow --profile emissionwatch --region ap-south-1`
(the function name is in the CloudFormation console; in bedrock mode a "Bedrock failed" warning explains any
template fallback).

## 4. Frontend against the API (local)
```bash
cd frontend
echo "VITE_API_URL=<ApiUrl>" > .env.local                    # gitignored (.env.*)
npm run dev                                                  # http://localhost:5173, allowed by CORS
```

### Local API (no AWS, nothing deployed)
`api/local_server.py` runs the same Lambda handlers behind a plain HTTP server on `http://localhost:8787`, reading
`pipeline/data/export/*.json` instead of S3 (re-read on every request). All 9 routes; CORS for localhost 5173/4173.
`/clusters/{id}/wind` calls Open-Meteo as in Lambda (ERA5 fallback when offline); briefs are in template mode unless
`BRIEF_MODE=bedrock` is set in the shell (needs AWS credentials with Bedrock access).
```bash
# terminal 1 (Git Bash)
cd api && .venv/Scripts/python.exe local_server.py             # --port 8787 --data ../pipeline/data/export are the defaults
# terminal 2
cd frontend && VITE_API_URL=http://localhost:8787 npm run dev  # http://localhost:5173
```
Windows cmd (from the repo root; two windows):
```bat
python api\local_server.py
cd frontend && set VITE_API_URL=http://localhost:8787&& npm run dev
```
`python` must be the API venv (`api\.venv\Scripts\activate` first, or call `api\.venv\Scripts\python.exe api\local_server.py`):
the handlers import boto3. In cmd, a space before `&&` would become part of the variable's value, hence `8787&&`.
`pipeline/data/export/` is gitignored: on a fresh clone run the exporter (step 1) or start the server with
`--data ../frontend/public/data` (the committed copy, same files). Check: `curl -s http://localhost:8787/states | head -c 200`.
A dev server that is already running keeps its old `VITE_API_URL`; the variable is read when Vite starts.

## 5. Amplify Hosting
1. Push `main` to GitHub.
2. Console → **AWS Amplify → Create new app → GitHub** → repo `Krish-0210/EmissionWatch`, branch `main`.
   Tick **"My app is a monorepo"**, app root `frontend`.
3. Build settings (replace the generated `amplify.yml` with this):
   ```yaml
   version: 1
   applications:
     - appRoot: frontend
       frontend:
         phases:
           preBuild:
             commands:
               - nvm install 22 && nvm use 22
               - npm ci
           build:
             commands:
               - npm run build
         artifacts:
           baseDirectory: dist
           files:
             - '**/*'
         cache:
           paths:
             - node_modules/**/*
   ```
4. **Environment variables**: `VITE_API_URL = <ApiUrl>` (no trailing slash).
5. **Rewrites and redirects** (needed for BrowserRouter deep links such as `/cluster/talcher`):
   source `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>`,
   target `/index.html`, type `200 (Rewrite)`.
6. Save and deploy. Note the domain, e.g. `https://main.d1234abcd.amplifyapp.com`.

## 6. Allow the Amplify domain in CORS
```bash
cd infra && source .venv/Scripts/activate
cdk deploy EmissionWatchStack --profile emissionwatch -c allowed_origins=https://main.d1234abcd.amplifyapp.com
```
(Comma-separate several origins. Add it to `cdk.json` → `context.allowed_origins` to make it stick. In bedrock mode
add `-c brief_mode=bedrock` here too.)

## Limits and cost guards
- HTTP API throttling: 10 rps, burst 20 (all routes, including `/wind`, `/rti`, `/plants` and `/states`); `POST /brief/{id}` 1 rps, burst 2.
- Lambda: 256 MB, 10 s timeout. Template mode (default) makes no Bedrock calls; in bedrock mode the call times
  out after 7 s and falls back to the template.
- Bucket is private (block public access, SSE-S3, TLS only); only the Lambda reads `data/*`.

## Teardown
```bash
cd infra && cdk destroy EmissionWatchStack --profile emissionwatch   # bucket is emptied and deleted
```
