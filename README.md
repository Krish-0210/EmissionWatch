# PanoptiCoal

Satellite-verified accountability for India's coal power plants.

## Problem
India's coal plants self-report stack emissions through OCEMS (Online Continuous Emission Monitoring Systems). Regulators cannot independently verify these numbers at scale, so under-reporting and non-functional pollution controls can go unnoticed.

## Solution
- **Expected vs observed:** estimate each plant's expected NO₂ output from its daily generation and installed controls, then compare it with what Sentinel-5P actually sees over the plant.
- **Audit Risk Score:** a score for each plant (or plant cluster) that ranks where the gap between expected and observed is largest and most persistent.
- **Inspection brief:** an AI-generated (Amazon Bedrock) summary for regulators of why a plant was flagged and what to check.
- **Citizen view:** a public map where anyone can see the plants near them and their risk scores.

## Architecture
Python pipeline (Google Earth Engine + generation data) → S3 → API Gateway + Lambda (Python) → React frontend on Amplify, with Bedrock generating the briefs. Infrastructure is defined in AWS CDK (Python).

## Data sources
- [Global Energy Monitor – Global Coal Plant Tracker](https://globalenergymonitor.org/projects/global-coal-plant-tracker/): plant locations, capacity, units
- [CEA daily generation reports](https://cea.nic.in/): plant-level daily generation
- Sentinel-5P TROPOMI NO₂ via [Google Earth Engine](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_NO2)
- [ERA5 reanalysis](https://cds.climate.copernicus.eu/): wind and boundary-layer meteorology
- [CPCB CAAQMS](https://app.cpcbccr.com/): ground-level air-quality stations

## Limitations
PanoptiCoal flags anomalies that **warrant an audit**. A flag is not proof of fraud or violation. Sentinel-5P pixels are about 5.5 × 3.5 km, so plants close to each other cannot be separated and are assessed together as clusters.

## Repo layout
```
docs/       architecture and data-source notes
pipeline/   ingestion, processing, scoring, export (Python)
api/        Lambda handlers (Python)
frontend/   React + Vite + TypeScript
infra/      AWS CDK (Python)
```

## License
MIT
