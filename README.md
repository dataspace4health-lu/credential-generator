# Gaia-X Self-Description Generator

## Overview 
This project is a Gaia-X Self-Description Generator that facilitates the creation, validation, and signing of Verifiable Credentials (VCs) and Verifiable Presentations (VPs). 

## Project Structure
```
..gitignore
data/
    regionCodes.json
    jsonldLoire.json
    jsonldTagus.json
    linkmlLoire.yaml
package.json
README.md
src/
    controllers/
        MainController.js                   # Core controller handling the application flow
    index.js                                # Entry point of the application
    modules/
        LegalRegistrationNumberModule.js    # Handles legal registration numbers
        ParameterManager.js                 # Manages input parameters and validation
        SelfDescriptionModule.js            # Generates self-descriptions based on ontology
        SignatureModule.js                  # Handles credential signing
        OutputManager.js                    # Manages saving and loading of output files

```

### Installation Process

1. Clone the repository:
    ```sh
    git clone https://github.com/your-repo/credential-generator.git
    cd credential-generator
    ```

2. Install dependencies:
    ```sh
    npm install
    ```

3. Install Bun:
    ```sh
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"  # Usually it will be added automatically
## Generating Executables
### Step 1: Bundle Your App Using Bun
```sh
bun build src/index.js --outfile dist/my-app.js --minify --target node
```
### Step 2: Compile to a Standalone Executable
```sh
bun build src/index.js --compile --outfile dist/credential-generator.exe --target bun-windows-x64
bun build src/index.js --compile --outfile dist/credential-generator --target bun-linux-x64
```
### Software Dependencies

- Node.js
- Bun
- Other dependencies listed in [`package.json`](package.json )