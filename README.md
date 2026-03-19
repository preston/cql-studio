# CQL Studio
![Docker Image Version](https://shields.foundry.hl7.org/docker/v/hlseven/quality-cql-studio)
![Docker Pulls](https://shields.foundry.hl7.org/docker/pulls/hlseven/quality-cql-studio)

A integrated web application suite for developing, testing, and publication of CQL (Clinical Quality Language) and FHIR-based artifacts using classical IDE concepts and optional AI-assisted drafting, as well as full support of official CQL _engine_ compatibility test cases, runner services, and results analysis.

See [CQL Studio Website](https://cqlstudio.com) for screenshots and product information.


## Quick Start with Docker

**This is just the UI component of CQL Studio. If you want to use the full distribution, you will likely want a fully configured, downloadable bundle such as distributed through [HL7 Foundry](https://foundry.hl7.org/products/fb509f14-5bc1-491b-a145-fab078a901c0)**.

The easiest way to run this application is using Docker:

### Build and Run with Docker

```bash
# Build the Docker image
docker build -t hlseven/quality-cql-studio:latest .

# Alternatively, build images for multiple architectures if supported by your build environment
docker buildx build --platform linux/arm64,linux/amd64 -t hlseven/quality-cql-studio:latest .

# Run the container
docker run -p 4200:80 hlseven/quality-cql-studio
```

Once the container is running, open your browser and navigate to `http://localhost:4200/`.


## Running from Source Code

### Prerequisites

- Current stable version of Node.js
- npm (comes with Node.js)

### Development Server

To start a local development server, run:

```bash
# Install dependencies
npm install

# Start the development server
npm run start
```

## Docker Details

This application uses a multi-stage Docker build:

1. **Builder Stage**: Uses Node.js 24 Alpine to install dependencies and build the Angular application
2. **Runtime Stage**: Uses Nginx Alpine to serve the built application

The Docker setup includes:
- `Dockerfile`: Multi-stage build configuration
- `nginx.conf`: Nginx configuration for serving the Angular app
- `entrypoint.sh`: Runtime configuration script

### Docker Environment Variables

The application supports runtime configuration through environment variables. The `entrypoint.sh` script processes `configuration.template.js` to generate the final configuration at runtime.

#### Available Environment Variables

- **CQL_STUDIO_RUNNER_BASE_URL**: Specifies the base URL for the CQL Tests Runner service. This URL is used to communicate with the runner backend for executing CQL tests and retrieving results. Defaults to `http://localhost:3000`.

- **CQL_STUDIO_FHIR_BASE_URL**: Specifies the base URL for the FHIR server. This URL is used for FHIR resource operations and data retrieval. Defaults to `http://localhost:8080/fhir`.


## Attribution & License

Copyright © 2025+ Preston Lee. All rights reserved. Provided under the Apache 2.0 license.
