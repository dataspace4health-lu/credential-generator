# Gaia-X Self-Description Generator

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A toolkit maintained by NTT Data Luxembourg for generating, validating, and signing Dataspace4Health self-descriptions using the Gaia-X framework as Verifiable Credentials (VCs) and Verifiable Presentations (VPs). It guides users through required inputs, supports template-based batch processing, and offers helper scripts for wallet key export and SSI Kit interactions.

## Features
- Interactive CLI to capture parameters and build Gaia-X-compliant credentials for Dataspace4Health.
- Supports Tagus (22.10) and Loire (24.06) ontology versions.
- Batch processing for CSV/Excel templates.
- Signing support using JSON Web Signature 2020.
- Utility scripts for wallet key export and SSI Kit operations.

## Project Structure
```
.gitignore
LICENSE
README.md
package.json
src/
  controllers/MainController.js           # Core controller handling the application flow
  index.js                                # Entry point of the application
  modules/
    LegalRegistrationNumberModule.js      # Handles legal registration numbers
    ParameterManager.js                   # Manages input parameters and validation
    SelfDescriptionModule.js              # Generates self-descriptions based on ontology
    SignatureModule.js                    # Handles credential signing
    ServiceOfferingModule.js              # Builds service offering shapes
    OutputManager.js                      # Manages saving and loading of output files
    BatchProcessingModule.js              # Processes CSV/Excel batches
    FileProcessorModule.js                # Parses input templates
scripts/
  *.sh                                    # Wallet and SSI Kit helper scripts
```

## Getting Started
### Prerequisites
- Node.js 18+
- npm

### Installation
```sh
npm install
```

### Usage
Run the generator and follow the prompts to create or sign a credential:
```sh
node src/index.js --help
node src/index.js --credentialType="Verifiable Credential (VC)" --ontologyVersion="24.06 (Loire)" --type="ServiceOffering" --shouldSign=false
```

For batch creation from templates:
```sh
node src/index.js --csv ./templates/complete-multi-value-template.xlsx --output ./output
```

### Wallet Key Export Tool
Script to securely export private keys from the Wallet API for a specific DID.

```bash
./scripts/wallet-export-key.sh -d <DID> -u <IAM_USERNAME> -b <BASE_URL>
```

**Parameters:**
- `-d, --did`: Full DID identifier
- `-u, --user`: IAM username (Keycloak)
- `-b, --base-url`: Base URL of your instance
- `-h, --help`: Show help

**Example:**
```bash
./scripts/wallet-export-key.sh \
  -d "did:web:org.dataspace4health.local:wallet:api:wallet-api:registry:Org" \
  -u org-did \
  -b https://org.dataspace4health.local
```

**Workflow:**
1. Resolves DID document and extracts key ID.
2. Tries direct kubectl pod access for faster export.
3. Falls back to wallet API authentication via Keycloak if pod method fails.
4. Exports private key in JWK format.

**Output:** Exports key to `exported_key.json` in JWK format.

## Testing
Run the smoke tests with:
```sh
npm test
```

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, coding standards, and how to propose changes. Please review the [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md) before contributing.

## License
Licensed under the [Apache License 2.0](LICENSE). See the [NOTICE](NOTICE) file for additional details.
