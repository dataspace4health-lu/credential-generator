import inquirer from "inquirer";
import validator from "validator";
import fs from "fs";
import countryRegions from "../../data/regionCodes.json";
import { createHash } from "crypto";
import fetch from "node-fetch";

export class ParameterManager {
  constructor() {
    this.validOntologyVersions = ["22.10 (Tagus)", "24.06 (Loire)"];
    this.validCredentialTypes = [
      "Verifiable Credential (VC)",
      "Verifiable Presentation (VP)",
    ];
  }

  validateValue(value, validValues) {
    return validValues.includes(value);
  }

  parseArguments(argv) {
    console.log("🔍 Parsing command-line arguments...");
    const parsedArgs = {};
    argv.forEach((arg) => {
      const [key, value] = arg.split(/[:=]/);
      parsedArgs[key.replace("--", "")] = value;
    });
    return parsedArgs;
  }

  displayHelp() {
    console.log(`
        Options:
          --credentialType=<type>       Specify the credential type ( Verifiable Credential (VC) or Verifiable Presentation (VP))
          --type=<type>                 Specify the type of the shape
          --ontologyVersion=<version>   Specify the ontology version ("22.10 (Tagus)" or "24.06 (Loire)")
          --shouldSign=<true|false>     Specify whether to sign the shape
          --privateKeyPath=<path>       Specify the path to the private key for signing
          --verificationMethod=<method> Specify the verification method
          --output=<path>               Specify the output directory or file path
          --help                        Display this help message
`);
  }

  async collectExecutableParameters(parameters, selfDescriptionModule) {
    // Step 1: Select Credential Type (VC or VP)
    if (
      !parameters.credentialType ||
      !this.validateValue(parameters.credentialType, this.validCredentialTypes)
    ) {
      console.warn(
        parameters.credentialType
          ? `⚠️  Invalid Credential Type : ${parameters.credentialType}`
          : "⚠️  Credential Type not provided."
      );

      parameters.credentialType = await this.askFromChoices(
        "📜 Select the credential type:",
        this.validCredentialTypes
      );
    }
    // Step 2: Validate or ask for the ontology version
    if (
      !parameters.ontologyVersion ||
      !this.validateValue(
        parameters.ontologyVersion,
        this.validOntologyVersions
      )
    ) {
      console.warn(
        parameters.ontologyVersion
          ? `⚠️  Invalid ontology version: ${parameters.ontologyVersion}`
          : "⚠️  Ontology version not provided."
      );
      parameters.ontologyVersion = await this.askFromChoices(
        "🌐 Select the ontology version:",
        this.validOntologyVersions
      );
    }

    // Step 3: Fetch valid types from SelfDescriptionModule
    if (parameters.credentialType === "Verifiable Credential (VC)") {
      const typesAndProperties =
        await selfDescriptionModule.fetchOntologyTypesAndProperties(
          parameters.ontologyVersion
        );
      const validTypes = Object.keys(typesAndProperties);

      // Step 4: Validate or ask for the type
      parameters.type = await this.validateOrAskType(
        parameters.type,
        validTypes
      );
      if (
        parameters.type === "LegalParticipant" ||
        parameters.type === "ServiceOffering"
      ) {
        parameters.vcUrl = await this.askForUrl(parameters.type);
      }
      if (
        parameters.type === "LocalRegistrationNumber" ||
        parameters.type === "legalRegistrationNumber"
      ) {
        console.log("🔍 RegistrationNumber type detected.");
        return parameters;
      }
    }
    // Ask if the user wants to sign
    parameters.shouldSign = await this.askForConfirmation(
      "✍️  Do you want to sign the generated shape?"
    );

    // If signing, ask whether to use a private key
    if (parameters.shouldSign) {
      var issuer = await this.askForIssuer("Enter the issuer DID:");
      parameters.issuer = issuer;
      const useOwnKey = await this.askForConfirmation(
        "🔑 Do you want to use your own signing key?",
        false
      );
      if (useOwnKey) {
        parameters.privateKeyPath = await this.askForFilePath(
          "Enter the path to your private key file:"
        );
        parameters.verificationMethod = await this.askForVerificationMethod();
      } else {
        console.log("🔑 Using default signing key...\n");
        parameters.privateKey = false; // Set default signing key logic if needed
        parameters.verificationMethod = issuer + "#key-0";
        // parameters.verificationMethod = "did:web:dataspace4health.local#key-0";
      }
    }
    return parameters;
  }

  async collectFilesForVP() {
    console.log("📂 Collecting files for Verifiable Presentation (VP)...");
    const files = [];
    let addMore = true;

    while (addMore) {
      const filePath = await this.askForFilePath("Enter the path to the file:");
      files.push(filePath);
      addMore = await this.askForMoreFiles();
    }
    return files;
  }

  async validateOrAskType(providedType, validTypes) {
    if (providedType && validTypes.includes(providedType)) {
      console.log(`✅ Valid type: ${providedType}`);
      return providedType;
    }

    if (providedType) {
      console.warn(
        `⚠️  Invalid type: ${providedType}. Please select a valid type.`
      );
    }

    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "type",
        message: "📄 Select the type of self-description:",
        choices: validTypes,
      },
    ]);
    return answer.type;
  }
  
  async collectAllProperties(typeProperties) {
    console.log("📋 Collecting all properties for the shape...");
    const collected = {};

    for (const [property, constraints] of Object.entries(typeProperties)) {
      // console.log(`🔍 Collecting property: ${property}`);
      if (property === "gx:hash") {
        continue;
      }
      collected[property] = await this.askForProperty(property, constraints);
    }

    return collected;
  }

  async collectRegistrationDetails() {
    const registrationTypes = ["leiCode", "vatID", "EORI", "EUID", "taxID"];

    // Prompt for registration type
    const { registrationType } = await inquirer.prompt([
      {
        type: "list",
        name: "registrationType",
        message: "📄 Select the registration type:",
        choices: registrationTypes,
      },
    ]);

    // Prompt for registration number
    const { registrationNumber } = await inquirer.prompt([
      {
        type: "input",
        name: "registrationNumber",
        message: `🔢 Enter the registration number for ${registrationType}:`,
        validate: (input) => {
          switch (registrationType) {
            case "leiCode":
              return (
                /^[A-Z0-9]{20}$/.test(input) ||
                `⚠️ Invalid ${registrationType} format. Please try again.`
              );
            case "vatID":
              return (
                /^[A-Z]{2}[0-9A-Za-z]{8,12}$/.test(input) ||
                `⚠️ Invalid ${registrationType} format. Please try again.`
              );
            case "EORI":
              return (
                /^[A-Z]{2}[0-9]{8,15}$/.test(input) ||
                `⚠️ Invalid ${registrationType} format. Please try again.`
              );
            case "EUID":
              return (
                validator.isAlphanumeric(input) ||
                `⚠️ Invalid ${registrationType} format. Please try again.`
              );
            case "taxID":
              return (
                validator.isNumeric(input) ||
                `⚠️ Invalid ${registrationType} format. Please try again.`
              );
            default:
              return `⚠️ Unknown registration type: ${registrationType}`;
          }
        },
      },
    ]);

    return { registrationType, registrationNumber };
  }

  async askForProperty(property, constraints) {
    const { description, range, required } = constraints;
    // console.log(`🔍 Collecting property: ${property}`);
    // console.log("Constraints", constraints);

    // Build the validation function based on constraints
    const validateInput = (input) => {
      if (required && !input) {
        return `⚠️ This property is required.`;
      }

      // Define property groups for special validations
      const uuidProperties = [
        "gx:legalRegistrationNumber",
        "gx:registrationNumber",
        "gx:gaiaxTermsAndConditions",
      ];
      const urlProperties = ["gx:providedBy"];
      const addressProperties = [
        "gx:headquarterAddress",
        "gx:legalAddress",
        "gx:headquartersAddress",
      ];

      // Special case for UUID and URL validations
      if ([...urlProperties, ...uuidProperties].includes(property)) {
        if (urlProperties.includes(property)) {
          if (!validator.isURL(input, { require_protocol: true })) {
            return `⚠️ Value must be a valid URL (e.g., https://example.com/credential).`;
          }
        } else {
          if (!validator.isUUID(input)) {
            return `⚠️ Value must be a valid UUID.`;
          }
        }
        return true;
      }

      // Special case for address properties (XX-XX format)
      if (addressProperties.includes(property)) {
        if (!countryRegions.includes(input)) {
          return `⚠️ Address must be one of the valid country regions (e.g., LU-CA).`;
        }
        return true;
      }

      switch (range) {
        case "integer":
          if (!validator.isInt(input)) return `⚠️ Value must be an integer.`;
          break;
        case "float":
        case "double":
          if (!validator.isFloat(input)) return `⚠️ Value must be a number.`;
          break;
        case "boolean":
          if (!["true", "false"].includes(input.toLowerCase()))
            return `⚠️ Value must be either 'true' or 'false'.`;
          break;
        case "string":
          if (input && !isNaN(input))
            return `⚠️ Value must be a non-numeric string.`;
          break;
        default:
          console.warn(`⚠️ Unknown range: ${range}. Skipping validation.`);
      }

      return true;
    };

    // Special case for gx:termsAndConditions
    if (property === "gx:termsAndConditions" || property === "gx:URL") {
      const answer = await inquirer.prompt([
        {
          type: "input",
          name: "gx:URL",
          message: `Enter URL for gx:termsAndConditions:`,
          validate: (input) =>
            validator.isURL(input, { require_protocol: true }) ||
            `⚠️ Value must be a valid URL (e.g., https://loripsum.net/api/plaintext).`,
        },
      ]);

      const url = answer["gx:URL"];

      try {
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(`Failed to fetch URL: ${response.statusText}`);

        const termsAndConditionsText = await response.text(); // Get the text content
        const hash = createHash("sha256")
          .update(termsAndConditionsText)
          .digest("hex"); // Compute SHA-256 hash

        return {
          "gx:URL": url,
          "gx:hash": hash,
        };
      } catch (error) {
        console.error(`❌ Error fetching URL: ${error.message}`);
        return `⚠️ Unable to fetch or process the text from the URL.`;
      }
    }

    // Special case for gx:dataAccountExport
    if (property === "gx:dataAccountExport") {
      const answer = await inquirer.prompt([
        {
          type: "list",
          name: "gx:requestType",
          message: "Select request type for gx:dataAccountExport:",
          choices: [
            "API",
            "email",
            "webform",
            "unregisteredLetter",
            "registeredLetter",
            "supportCenter",
          ],
        },
        {
          type: "list",
          name: "gx:accessType",
          message: "Select access type for gx:dataAccountExport:",
          choices: ["digital", "physical"],
        },
        {
          type: "input",
          name: "gx:formatType",
          message:
            "Enter format type for gx:dataAccountExport (e.g., application/json):",
          validate: (input) =>
            /^\w+\/[-+.\w]+$/.test(input) ||
            `⚠️ Format type must match pattern (e.g., application/json).`,
        },
      ]);

      return {
        "gx:requestType": answer["gx:requestType"],
        "gx:accessType": answer["gx:accessType"],
        "gx:formatType": answer["gx:formatType"],
      };
    }
    if (property === "gx:dataProtectionRegime") {
      const answer = await inquirer.prompt([
        {
          type: "list",
          name: "gx:dataProtectionRegime",
          message: "Select data protection regime:",
          choices: [
            {
              name: "GDPR2016: General Data Protection Regulation / EEA",
              value: "GDPR2016",
            },
            {
              name: "LGPD2019: General Personal Data Protection Law (Lei Geral de Proteção de Dados Pessoais) / BRA",
              value: "LGPD2019",
            },
            {
              name: "PDPA2012: Personal Data Protection Act 2012 / SGP",
              value: "PDPA2012",
            },
            {
              name: "CCPA2018: California Consumer Privacy Act / US-CA",
              value: "CCPA2018",
            },
            {
              name: "VCDPA2021: Virginia Consumer Data Protection Act / US-VA",
              value: "VCDPA2021",
            },
          ],
        },
      ]);
      return answer["gx:dataProtectionRegime"];
    }

    // Default case: Prompt for single property
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: property,
        message: `Enter value for ${property} (${
          description || "No description"
        }):`,
        validate: validateInput,
      },
    ]);
    if (
      property === "gx:legalRegistrationNumber" ||
      property === "gx:registrationNumber" ||
      property === "gx:providedBy"
    ) {
      return { id: answer[property] };
    }
    if (
      [
        "gx:headquarterAddress",
        "gx:legalAddress",
        "headquartersAddress",
        "legalAddress",
      ].includes(property)
    ) {
      return { "gx:countrySubdivisionCode": answer[property] };
    }

    return answer[property];
  }

  async askType() {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "type",
        message: "📄 Enter the type of self-description:",
        validate: (input) => {
          if (validator.isEmpty(input)) {
            return "⚠️   Type of self-description cannot be empty.";
          }
          return true;
        },
      },
    ]);
    return answer.type;
  }

  async askForIssuer() {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "issuer",
        message: "🔍 Enter your issuer DID:",
        validate: (input) => {
          // Regular expression for validating a DID without allowing fragments (#...)
          const didRegex = /^did:[a-z0-9]+:[a-zA-Z0-9.\-]+$/;

          if (
            validator.isURL(input, { require_protocol: true }) ||
            didRegex.test(input)
          ) {
            return true;
          }
          return "⚠️ Invalid issuer. Use a valid DID (e.g., did:web:example.com).";
        },
      },
    ]);
    return answer.issuer;
  }

  async askForUrl(type) {
    const message =
      type === "ServiceOffering"
        ? "🔍 Enter the URL of the service offering:"
        : "🔍 Enter the URL of the legal participant:";
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "url",
        message: message,
        validate: (input) => {
          if (validator.isURL(input, { require_protocol: true })) {
            return true;
          }
          return "⚠️ Invalid URL. Please enter a valid URL.";
        },
      },
    ]);
    return answer.url;
  }
  async askFromChoices(message, choices) {
    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: message,
        choices: choices,
      },
    ]);
    return answer.choice;
  }

  async askForConfirmation(message) {
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmation",
        message: message,
        default: false,
      },
    ]);
    return answer.confirmation;
  }

  async askForFilePath(message) {
    const { filePath } = await inquirer.prompt([
      {
        type: "input",
        name: "filePath",
        message: message,
        validate: (input) => {
          if (!fs.existsSync(input)) {
            return "⚠️ File does not exist. Please enter a valid file path.";
          }
          if (!fs.lstatSync(input).isFile()) {
            return "⚠️ Path does not point to a file. Please provide a valid file path.";
          }
          return true;
        },
      },
    ]);
    return filePath;
  }

  async askForVerificationMethod() {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "verificationMethod",
        message: "🔍 Enter your verification method (DID or URL):",
        validate: (input) => {
          // Ensure it's either a valid URL or DID
          if (
            validator.isURL(input, { require_protocol: true }) ||
            /^did:[a-z0-9]+:[a-zA-Z0-9.\-]+(#.+)?$/.test(input)
          ) {
            return true;
          }
          return "⚠️ Invalid verification method. Use a valid DID (e.g., did:web:example.com#key-1) or a URL.";
        },
      },
    ]);
    return answer.verificationMethod;
  }

  async askForMoreFiles() {
    const { moreFiles } = await inquirer.prompt([
      {
        type: "confirm",
        name: "moreFiles",
        message: "Would you like to add another file?",
        default: true,
      },
    ]);
    return moreFiles;
  }
}
