import inquirer from "inquirer";
import validator from "validator";
import fs from "fs";
import countryRegions from "../../data/regionCodes.json";
import licenseList from "../../data/licenseList.json";
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
          --output=<path>               Specify the output directory or file 
          --input=<filePath>            Specify the path to the input file
          --help                        Display this help message
`);
  }

  async collectExecutableParameters(parameters, selfDescriptionModule) {
    if (parameters.input) {
      return await this.handleInputFile(parameters);
    }
    const { uploadCredential } = await inquirer.prompt([
      {
        type: "confirm",
        name: "uploadCredential",
        message: "📤 Do you want to use an existing credential for signing?",
        default: false,
      },
    ]);

    if (uploadCredential) {
      return await this.handleUploadCredential(parameters);
    }

    // Step 1: Select Credential Type (VC or VP)
    await this.collectCredentialType(parameters);
    // Step 2: Validate or ask for the ontology version
    await this.collectOntologyVersion(parameters);
    // Step 3: Fetch valid types from SelfDescriptionModule
    await this.collectTypeSpecificParameters(parameters, selfDescriptionModule);

    // Early return for RegistrationNumber types
    if (
      parameters.type === "LocalRegistrationNumber" ||
      parameters.type === "legalRegistrationNumber"
    ) {
      console.log(
        "🔍 RegistrationNumber type detected. Skipping signing process."
      );
      return parameters;
    }

    // Ask if the user wants to sign
    parameters.shouldSign = await this.askForConfirmation(
      "✍️  Do you want to sign the generated shape?"
    );

    // If signing, ask whether to use a private key
    if (parameters.shouldSign) {
      parameters.issuer = await this.askForIssuer("Enter the issuer DID:");
      await this.handleSigningKey(parameters);
    }
    return parameters;
  }

  async handleInputFile(parameters) {
    // Validate or prompt for the input file path
    parameters.uploadedCredentialPath = await this.validateOrPromptFilePath(
      parameters.input,
      "Enter the path to the credential file:"
    );

    // Prompt for the issuer DID
    parameters.issuer = await this.askForIssuer("Enter the issuer DID:");

    // Handle signing key logic
    await this.handleSigningKey(parameters);

    // Return the updated parameters
    return parameters;
  }

  async handleUploadCredential(parameters) {
    // Prompt the user for the path to the credential file
    parameters.uploadedCredentialPath = await this.askForFilePath(
      "Enter the path to the credential file:"
    );

    // Prompt the user for the issuer DID
    parameters.issuer = await this.askForIssuer("Enter the issuer DID:");

    // Handle signing key logic
    await this.handleSigningKey(parameters);

    // Return the updated parameters
    return parameters;
  }

  async collectCredentialType(parameters) {
    parameters.credentialType = await this.validateOrPromptChoice(
      parameters.credentialType,
      this.validCredentialTypes,
      "\n📜 Select the credential type:",
      "⚠️  Invalid Credential Type"
    );
  }

  async collectOntologyVersion(parameters) {
    parameters.ontologyVersion = await this.validateOrPromptChoice(
      parameters.ontologyVersion,
      this.validOntologyVersions,
      "🌐 Select the ontology version:",
      "⚠️ Invalid ontology version. Please select a valid one."
    );
  }

  async collectTypeSpecificParameters(parameters, selfDescriptionModule) {
    if (parameters.credentialType === "Verifiable Credential (VC)") {
      const typesAndProperties =
        await selfDescriptionModule.fetchOntologyTypesAndProperties(
          parameters.ontologyVersion
        );

      // Step 4: Filter the valid types to only show the allowed ones
      const allowedShapes = [
        "LegalParticipant",
        "legalRegistrationNumber",
        "ServiceOffering",
        "GaiaXTermsAndConditions",
      ];

      const validTypes = Object.keys(typesAndProperties).filter((type) =>
        allowedShapes.includes(type)
      );

      // Step 4: Validate or ask for the type
      parameters.type = await this.validateOrAskType(
        parameters.type,
        validTypes
      );
      if (parameters.type === "LegalParticipant") {
        const includeInServiceOffering = await this.askForConfirmation(
          "Do you want to include this legal participant in the service offering?"
        );
        if (!includeInServiceOffering) {
          parameters.vcUrl = await this.askForUrl(parameters.type);
        }
      }
      if (parameters.type === "ServiceOffering") {
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
  }
  // Helper function to validate or prompt for a file path
  async validateOrPromptFilePath(filePath, promptMessage) {
    if (fs.existsSync(filePath)) {
      console.log("📥 Using provided input file for credential generation.");
      return filePath;
    } else {
      console.warn(`⚠️  Invalid input file path: ${filePath}`);
      return await this.askForFilePath(promptMessage);
    }
  }
  // Helper function to handle signing key logic
  async handleSigningKey(parameters) {
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
      parameters.verificationMethod = parameters.issuer + "#key-0";
    }
  }

  // Helper function to validate or prompt for a choice
  async validateOrPromptChoice(
    value,
    validValues,
    promptMessage,
    warningMessage
  ) {
    if (!value || !this.validateValue(value, validValues)) {
      console.warn(warningMessage);
      return await this.askFromChoices(promptMessage, validValues);
    }
    return value;
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
  async collectAllProperties(properties, typesAndProperties) {
    console.log("📋 Collecting all properties for the shape...");
    const collected = {};

    for (const [property, constraints] of Object.entries(properties)) {
      // console.log(`🔍 Collecting property: ${property}`);
      if (property === "gx:hash") {
        continue;
      }
      // Handle criteria collection separately
      if (property === "gx:criteria") {
        console.log("🔍 Collecting criteria...");
        if (!typesAndProperties["ServiceOfferingCriteria"]) {
          console.error(
            "❌ ServiceOfferingCriteria not found in typesAndProperties"
          );
          continue;
        }
        collected[property] = await this.collectCriteriaProperties(
          typesAndProperties["ServiceOfferingCriteria"].properties
        );
        continue;
      }

      // For all other properties, use the modular askForProperty
      collected[property] = await this.askForProperty(property, constraints);
    }
    // Explicitly drain any buffered input without pausing stdin permanently
    process.stdin.setEncoding("utf8");
    process.stdin.resume();

    while (process.stdin.read() !== null) {
      // Consume buffered input until empty
    }
    return collected;
  }

  async collectCriteriaProperties(criteriaProperties) {
    // Separate out criteria collection into its own function
    const criteriaResponses = { type: "gx:ServiceOfferingCriteria" };
    for (const [criteriaProperty, criteriaConstraints] of Object.entries(
      criteriaProperties
    )) {
      criteriaResponses[criteriaProperty] = {
        type: "gx:CriteriaResponse",
        ...(await this.askForProperty(criteriaProperty, criteriaConstraints)),
      };
    }
    return criteriaResponses;
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
      // Special handling for 'gx:policy' property
      if (property === "gx:policy") return true;
      if (property === "gx:port") {
        if (!validator.isInt(input)) {
          return "⚠️ Port must be a valid number.";
        }
        return true;
      }
      if (required && !input) return `⚠️ This property is required.`;

      const urlProperties = ["id", "gx:openAPI"];
      if (
        urlProperties.includes(property) &&
        input &&
        !validator.isURL(input, { require_protocol: true })
      ) {
        return `⚠️ ${property} must be a valid URL.`;
      }

      // Define property groups for special validations
      const uuidProperties = [
        "gx:legalRegistrationNumber",
        "gx:registrationNumber",
        "gx:gaiaxTermsAndConditions",
        "gx:assignedTo",
        "gx:hostedOn",
        "gx:instanceOf",
        "gx:exposedThrough",
      ];
      // Special case for UUID validations
      if (uuidProperties.includes(property) && !validator.isUUID(input)) {
        return `⚠️ Value must be a valid UUID.`;
      }

      const addressProperties = [
        "gx:headquarterAddress",
        "gx:legalAddress",
        "gx:headquartersAddress",
      ];
      // Special case for address properties (XX-XX format)
      if (
        addressProperties.includes(property) &&
        !countryRegions.includes(input)
      ) {
        return `⚠️ Address must be one of the valid country regions (e.g., LU-CA).`;
      }

      const didProperties = [
        "gx:providedBy",
        "gx:producedBy",
        "gx:maintainedBy",
        "gx:tenantOwnedBy",
      ];
      const didRegex = /^did:[a-z0-9]+:[a-zA-Z0-9.\-]+$/;
      if (didProperties.includes(property)) {
        return didRegex.test(input) || `⚠️ Value must be a valid DID.`;
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
        case "datetime":
          if (input && !validator.isISO8601(input))
            return `⚠️ Value must be a valid ISO 8601 date format.`;
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
    // Handle individual criteria properties (e.g., gx:P4.1.2, gx:P1.1.1, gx:P3.1.1)
    if (property.startsWith("gx:P")) {
      console.log(`🔍 Collecting response for: ${property}`);

      const response = await this.askFromChoices(
        `Select response for ${property}: ${description}`,
        ["Confirm", "Deny", "Not applicable"]
      );
      let evidence = {};
      let reason;
      if (response === "Not applicable") {
        reason = await this.promptInput(
          "Provide a reason (Optional reason when not applicable)",
          (input) => true // No validation for optional input
        );
      }
      const addEvidence = await this.askForConfirmation(
        "Do you want to provide evidence? (Default: No)"
      );
      if (addEvidence) {
        const website = await this.promptInput(
          "Provide a link to the website for evidence information:",
          (input) =>
            validator.isURL(input, { require_protocol: true }) ||
            "⚠️ Value must be a valid URL (e.g., https://example.com)."
        );
        const pdf = await this.promptInput(
          "Provide a link to the attestation PDF for evidence information:",
          (input) =>
            validator.isURL(input, { require_protocol: true }) ||
            "⚠️ Value must be a valid URL (e.g., https://example.com)."
        );
        evidence = {
          "gx:evidence": {
            "gx:website": website,
            "gx:pdf": pdf,
          },
        };
      }

      return {
        "gx:description": description,
        "gx:response": response,
        ...(reason && { "gx:reason": reason }),
        ...evidence,
      };
    }
    // Special case for gx:termsAndConditions
    if (property === "gx:termsAndConditions" || property === "gx:URL") {
      let url, termsAndConditionsText, hash;
      while (true) {
        const answer = await inquirer.prompt([
          {
            type: "input",
            name: "gx:URL",
            message: `Enter URL for gx:termsAndConditions:`,
            validate: (input) =>
              validator.isURL(input, { require_protocol: true }) ||
              `⚠️ Value must be a valid URL (e.g., https://baconipsum.com/api/?type=all-meat&paras=2&format=text).`,
          },
        ]);

        url = answer["gx:URL"];

        try {
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(`Failed to fetch URL: ${response.statusText}`);

          termsAndConditionsText = await response.text(); // Get the text content
          hash = createHash("sha256")
            .update(termsAndConditionsText)
            .digest("hex"); // Compute SHA-256 hash
          break; // Exit the loop if fetch is successful
        } catch (error) {
          console.error(`❌ Error fetching URL: ${error.message}`);
          console.log(`⚠️ Please enter a reachable URL.`);
        }
      }

      return {
        "gx:URL": url,
        "gx:hash": hash,
      };
    }
    // Add this case explicitly within your askForProperty method
    if (property === "gx:serviceAccessPoint") {
      const serviceAccessPoints = [];

      let addMore = true;
      while (addMore) {
        const { accessPoint } = await inquirer.prompt([
          {
            type: "input",
            name: "accessPoint",
            message: "Enter the id (UUID) of the service access point:",
            validate: (input) => {
              return (
                validator.isUUID(input) ||
                "⚠️ Invalid UUID format. Please enter a valid UUID."
              );
            },
          },
        ]);

        serviceAccessPoints.push({ "@id": accessPoint });

        const { continueAdding } = await inquirer.prompt([
          {
            type: "confirm",
            name: "continueAdding",
            message: "Would you like to add another service access point?",
            default: false,
          },
        ]);

        addMore = continueAdding;
      }

      return serviceAccessPoints;
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
    if (property === "gx:license") {
      if (!licenseList.length) {
        throw new Error("❌ License list is empty or could not be loaded.");
      }

      const answer = await inquirer.prompt([
        {
          type: "list",
          name: property,
          message: `Select a license for ${property}:`,
          choices: licenseList,
        },
      ]);
      return answer[property];
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
        filter: (input) => {
          // Explicitly handle gx:port conversion
          if (property === "gx:port") {
            return String(input.trim());
          }
          return input;
        },
      },
    ]);
    // Explicitly handle empty input for gx:policy
    if (property === "gx:policy" && !answer[property]) {
      return "default: allow";
    }
    const idProperties = [
      "gx:legalRegistrationNumber",
      "gx:registrationNumber",
      "gx:providedBy",
      "gx:assignedTo",
      "gx:maintainedBy",
      "gx:hostedOn",
      "gx:instanceOf",
      "gx:tenantOwnedBy",
      "gx:producedBy",
      "gx:exposedThrough",
    ];

    if (idProperties.includes(property)) {
      return { id: answer[property] };
    }
    const addressProperties = [
      "gx:headquarterAddress",
      "gx:legalAddress",
      "headquartersAddress",
      "legalAddress",
    ];

    if (addressProperties.includes(property)) {
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
      type === "ServiceOffering" || type === "ServiceOfferingLabelLevel1"
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

  async promptInput(message, validateFn) {
    const { input } = await inquirer.prompt([
      {
        type: "input",
        name: "input",
        message: message,
        validate: validateFn,
      },
    ]);
    return input;
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
