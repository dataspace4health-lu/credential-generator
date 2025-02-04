import inquirer from "inquirer";
import validator from "validator";
import path from "path";
import fs from "fs";

export class ParameterManager {
  constructor() {
    this.validOntologyVersions = ["22.10 (Tagus)", "24.06 (Loire)"];
  }

  validateOntologyVersion(version) {
    return this.validOntologyVersions.includes(version);
  }

  parseArguments(argv) {
    console.log("🔍 Parsing command-line arguments...");
    const parsedArgs = {};
    argv.forEach((arg) => {
      const [key, value] = arg.split("=");
      parsedArgs[key.replace("--", "")] = value;
    });
    return parsedArgs;
  }

  async collectExecutableParameters(parameters, selfDescriptionModule) {
    // Step 1: Validate or ask for the ontology version
    if (
      !parameters.ontologyVersion ||
      !this.validateOntologyVersion(parameters.ontologyVersion)
    ) {
      console.warn(
        parameters.ontologyVersion
          ? `⚠️  Invalid ontology version: ${parameters.ontologyVersion}`
          : "⚠️  Ontology version not provided."
      );
      parameters.ontologyVersion = await this.askOntologyVersion();
    }

    // Step 2: Fetch valid types from SelfDescriptionModule
    const typesAndProperties =
      await selfDescriptionModule.fetchOntologyTypesAndProperties(
        parameters.ontologyVersion
      );
    const validTypes = Object.keys(typesAndProperties);

    // Step 3: Validate or ask for the type
    parameters.type = await this.validateOrAskType(parameters.type, validTypes);

    if (
      parameters.type === "LocalRegistrationNumber" ||
      parameters.type === "legalRegistrationNumber"
    ) {
      console.log("🔍 RegistrationNumber type detected.");
      return parameters;
    }

    // Ask if the user wants to sign
    parameters.shouldSign = await this.askShouldSign();

    // If signing, ask whether to use a private key
    if (parameters.shouldSign) {
      const useOwnKey = await this.askUseOwnKey();
      if (useOwnKey) {
        parameters.privateKeyPath = await this.askPrivateKeyPath();
      } else {
        console.log("🔑 Using default signing key...\n");
        parameters.privateKey = false; // Set default signing key logic if needed
      }
    }

    return parameters;
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

      // Special case for gx:legalRegistrationNumber (URL validation)
      if (
        property === "gx:legalRegistrationNumber" ||
        property === "gx:registrationNumber" ||
        property === "gx:gaiaxTermsAndConditions" ||
        property === "gx:url"
      ) {
        if (!validator.isURL(input)) {
          return `⚠️ Value must be a valid URL (e.g., https://example.com/credential).`;
        }
        return true;
      }

      // Special case for gx:headquarterAddress and gx:legalAddress (XX-XX format)
      if (
        [
          "gx:headquarterAddress",
          "gx:legalAddress",
          "gx:headquartersAddress",
        ].includes(property)
      ) {
        const filePath = path.resolve(__dirname, "../../data/regionCodes.json");
        const countryRegions = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        // console.log("countryRegions", countryRegions);

        if (!countryRegions.includes(input)) {
          return `⚠️ Address must be one of the valid country regions (e.g., LU-CA).`;
        }
        return true;
      }
      if (property === "gx:hash") {
        const expectedHash =
          "4bd7554097444c960292b4726c2efa1373485e8a5565d94d41195214c5e0ceb3";
        if (input !== expectedHash) {
          return `⚠️ Value must be the exact SHA-256 hash: ${expectedHash}`;
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
      property === "gx:registrationNumber"
    ) {
      return {
        id: answer[property],
      };
    }
    if (
      [
        "gx:headquarterAddress",
        "gx:legalAddress",
        "headquartersAddress",
        "legalAddress",
      ].includes(property)
    ) {
      return {
        "gx:countrySubdivisionCode": answer[property],
      };
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

  async askOntologyVersion() {
    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "ontologyVersion",
        message: "🌐 Select the ontology version:",
        choices: ["22.10 (Tagus)", "24.06 (Loire)"],
      },
    ]);
    return answer.ontologyVersion;
  }

  async askUseOwnKey() {
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "useOwnKey",
        message: "🔑 Do you want to use your own signing key?",
        default: false,
      },
    ]);
    return answer.useOwnKey;
  }

  async askShouldSign() {
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "shouldSign",
        message: "✍️  Do you want to sign the generated shape?",
        default: true,
      },
    ]);
    return answer.shouldSign;
  }

  async askPrivateKeyPath() {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "privateKeyPath",
        message: "Enter the path to your private key file:",
        validate: (input) => {
          if (!fs.existsSync(input)) {
            return "File does not exist. Please provide a valid path.";
          }
          if (!fs.lstatSync(input).isFile()) {
            return "Path does not point to a file. Please provide a valid file path.";
          }
          return true;
        },
      },
    ]);
    return answer.privateKeyPath;
  }

  //   validateRegistrationNumber(input, type) {
  //     switch (type) {
  //       case "leiCode":
  //         return /^[A-Z0-9]{20}$/.test(input);
  //       case "vatID":
  //         return /^[A-Z]{2}[0-9A-Za-z]{8,12}$/.test(input);
  //       case "EORI":
  //         return /^[A-Z]{2}[0-9]{8,15}$/.test(input);
  //       case "EUID":
  //         return validator.isAlphanumeric(input);
  //       case "taxID":
  //         return validator.isNumeric(input);
  //       default:
  //         return false;
  //     }
  //   }
}
