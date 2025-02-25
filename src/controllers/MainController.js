import { ParameterManager } from "../modules/ParameterManager.js";
import { SelfDescriptionModule } from "../modules/SelfDescriptionModule.js";
import { SignatureModule } from "../modules/SignatureModule.js";
import { OutputManager } from "../modules/OutputManager.js";
import { LegalRegistrationNumberModule } from "../modules/LegalRegistrationNumberModule.js";

import { v4 as uuid4 } from "uuid";

export class MainController {
  constructor() {
    this.parameterManager = new ParameterManager();
    this.selfDescriptionModule = new SelfDescriptionModule(
      this.parameterManager
    );
    this.outputManager = new OutputManager();
    this.signatureModule = new SignatureModule(this.outputManager);
    this.legalRegistrationNumberModule = new LegalRegistrationNumberModule();
  }

  async run(argv) {
    console.log("\n========================================");
    console.log("   Gaia-X Self-Description Generator    ");
    console.log("========================================\n");

    if (argv.includes("--help")) {
      this.parameterManager.displayHelp();
      return;
    }

    try {
      console.log("🚀 Starting workflow...\n");

      // Step 1: Parse and validate parameters
      const parameters = this.parameterManager.parseArguments(argv);
      console.log("✅ Arguments parsed successfully.\n");

      // Step 2: Collect executable parameters
      const executableParams =
        await this.parameterManager.collectExecutableParameters(
          parameters,
          this.selfDescriptionModule
        );

        console.log("executableParams", executableParams);
        if (parameters.credentialType === "Verifiable Presentation (VP)") {
          await this.handleVerifiablePresentation(executableParams);
        } else {
          await this.handleVerifiableCredential(executableParams);
        }
        console.log("\n🎉 Workflow completed successfully!");
      } catch (error) {
        console.error(`\n❌ An error occurred: ${error.message}`);
      } finally {
        console.log("\n========================================");
      }
      // console.log("✅ Executable parameters collected successfully.\n");
      // console.log("Executable parameters: ", executableParams);

      // Step 3: Start shape generation workflow

      // await this.handleShape(executableParams);

  } 

  async handleVerifiableCredential(executableParams) {
    const {
      type,
      ontologyVersion,
      shouldSign,
      privateKeyPath,
      vcUrl,
      verificationMethod,
      output = "./output",
    } = executableParams;

    console.log(`🔧 Executing workflow for type: ${type}...\n`);

    let vcShape;

    if (type === "legalRegistrationNumber" || type === "LocalRegistrationNumber") {
      console.log("📋 Handling Legal Registration Number (LRN) workflow...");

      // Collect registration details
      const { registrationType, registrationNumber } =
        await this.parameterManager.collectRegistrationDetails();
      console.log(
        `✅ Collected registration details: Type - ${registrationType}, Number - ${registrationNumber}`
      );

      // Generate the LRN shape
      const vcid = uuid4(); // Verifiable Credential ID
      const credentialSubjectId = uuid4(); // Credential Subject ID
      vcShape =
        await this.legalRegistrationNumberModule.createLegalRegistrationNumberShape(
          ontologyVersion,
          vcid,
          credentialSubjectId,
          registrationType,
          registrationNumber
        );

      console.log("✅ LRN shape created successfully:\n");

      // Save the LRN shape directly
      console.log("Saving the LRN shape...");
      await this.outputManager.saveToFile(output, `${type}.json`, vcShape);
      console.log("📂 LRN shape saved successfully.");
      return; // Exit the function to avoid signing logic
    }

    // General case for other types
    vcShape = await this.selfDescriptionModule.generateShape(executableParams);

    console.log("✅ Shape generated successfully.\n");

    let finalShape = vcShape;

    // Handle signing logic
    if (shouldSign) {
      console.log("✍️  Signing the shape...");
      finalShape = await this.signatureModule.signDocument(
        ontologyVersion,
        vcShape,
        privateKeyPath,
        verificationMethod

      );
      console.log("✅ Shape signed successfully.\n");
    } else {
      console.log("⚠️  Skipping signing as per user choice.");
    }

    // Save the signed shape
    console.log("💾 Saving the final shape...");
    await this.outputManager.saveToFile(output, `${type}.json`, finalShape);

    // console.log(`${type} shape handling completed successfully!`);
  }
  async handleVerifiablePresentation(executableParams) {
    console.log("parameters", executableParams);
    const {
      credentialType,
      type,
      ontologyVersion,
      shouldSign,
      privateKeyPath,
      verificationMethod,
      output = "./output",
    } = executableParams;

    console.log("📋 Handling Verifiable Presentation (VP) workflow...");
    const selectedFiles = await this.parameterManager.collectFilesForVP();

    if (selectedFiles.length === 0) {
      throw new Error("❌ No files selected for Verifiable Presentation.");
    }

    // General case for other types
    let vpShape
    vpShape = await this.selfDescriptionModule.generateVpShape(
      ontologyVersion,
      selectedFiles
    );

    console.log("✅ Shape generated successfully.\n");
    // console.log("vpShape", vpShape);

    let finalShape = vpShape;

    // Handle signing logic
    if (shouldSign) {
      console.log("✍️  Signing the shape...");
      finalShape = await this.signatureModule.signDocument(
        ontologyVersion,
        vpShape,
        privateKeyPath,
        verificationMethod
      );
      console.log("✅ Shape signed successfully.\n");
      // console.log("finalShape", finalShape);
    } else {
      console.log("⚠️  Skipping signing as per user choice.");
    }

    console.log("Saving the VP...");
    this.outputManager.saveToFile(
      output,
      "verifiable_presentation.json",
      finalShape
    );
    console.log("✅ VP handling completed successfully!");
  }
}
