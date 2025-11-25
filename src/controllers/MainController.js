/*
 * Copyright 2025 NTT Data Luxembourg
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ParameterManager } from "../modules/ParameterManager.js";
import { SelfDescriptionModule } from "../modules/SelfDescriptionModule.js";
import { SignatureModule } from "../modules/SignatureModule.js";
import { OutputManager } from "../modules/OutputManager.js";
import { LegalRegistrationNumberModule } from "../modules/LegalRegistrationNumberModule.js";
import { ServiceOfferingModule } from "../modules/ServiceOfferingModule.js";
import { BatchProcessingModule } from "../modules/BatchProcessingModule.js";

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
    this.serviceOfferingModule = new ServiceOfferingModule(
      this.selfDescriptionModule
    );
    this.batchProcessingModule = new BatchProcessingModule(
      this.parameterManager,
      this.signatureModule,
      this.outputManager,
      this.legalRegistrationNumberModule,
      this.serviceOfferingModule,
      this.selfDescriptionModule
    );
  }

  async run(argv) {
      console.log("\n========================================");
      console.log(" Gaia-X Self-Description Generator ");
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

      // Check if CSV mode is activated for batch processing
      if (executableParams.isCsvMode) {
        console.log("📊 CSV batch processing mode activated");
        await this.handleCsvBatchProcessing(executableParams);
      } else if (parameters.uploadedCredentialPath) {
        console.log("🔄 Uploading existing credential for signing...");
        const credential = await this.outputManager.loadCredential(
          parameters.uploadedCredentialPath
        );

        let credentialToSign = credential;

        if (
          Array.isArray(credential.type) &&
          credential.type.includes("VerifiablePresentation")
        ) {
          console.log(
            "📦 Detected Verifiable Presentation. Fetching contained credentials..."
          );

          const vcOptions = credential.verifiableCredential
            .filter(
              (vc) =>
                Array.isArray(vc.type) &&
                vc.type.includes("VerifiableCredential")
            )
            .map((vc) => {
              const label =
                vc.type.find((t) => t !== "VerifiableCredential") ||
                vc.type[0];
              return {
                name: `${label} (${vc.id})`,
                value: vc,
              };
            });

          if (vcOptions.length === 0) {
            throw new Error(
              "No Verifiable Credentials found inside the presentation."
            );
          }

          const selectedCredential = await this.parameterManager.askFromChoices(
            "\nWhich credential would you like to sign?",
            vcOptions
          );

         credentialToSign = selectedCredential;
        }
        var signedCredential = await this.handleSigningUploadedCredential(
          executableParams,
          credentialToSign
        );
          // Save the signed credential
          const outputFilePath = parameters.output || "./output";
          const rawType = credentialToSign.credentialSubject?.type || "credential";
          const safeType = rawType.replace(/[:gx]/g, ''); // remove gx: or any other prefix
          const fileName = `signed_${safeType}.json`;
          await this.outputManager.saveToFile(outputFilePath, fileName, signedCredential);

      } else {
        if (parameters.credentialType === "Verifiable Presentation (VP)") {
          await this.handleVerifiablePresentation(executableParams);
        } else {
          await this.handleVerifiableCredential(executableParams);
        }
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
    } else if (type === "ServiceOffering") {
      console.log("📋 Handling Service Offering workflow...");

      // Collect service offering details
      const extractedProperties = await this.serviceOfferingModule.handleServiceOffering(
        executableParams
      );
      
      vcShape = await this.serviceOfferingModule.createVcShapeObject(executableParams, extractedProperties);

      // console.log(`✅ Collected service details: `, vcShape);
    } else {
      // General case for other types
      vcShape = await this.selfDescriptionModule.generateShape(
        executableParams
      );

      console.log("✅ Shape generated successfully.\n");

    }
    
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
    const defaultFileName = vcUrl ? `${type}_URI.json` : `${type}.json`;
    await this.outputManager.saveToFile(output, defaultFileName, finalShape);

    // console.log(`${type} shape handling completed successfully!`);
  }
  async handleVerifiablePresentation(executableParams) {
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
    // console.log("executableParams", executableParams);
    let vpShape
    vpShape = await this.selfDescriptionModule.generateVpShape(
      executableParams,
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
  async handleSigningUploadedCredential(executableParams, credential) {
    const { ontologyVersion = "22.10 (Tagus)", privateKeyPath, verificationMethod, output } = executableParams;
  
    console.log("✍️  Checking credential for existing proof...");
  
    let options = {};
  
    // Check if the credential has existing proofs
    if (credential.proof) {
      console.log("🔄 Existing proof detected. Preparing to add a new proof...");
      //options.previousProof = credential.proof.id || (Array.isArray(credential.proof) ? credential.proof.map(p => p.id) : undefined);
    }
  
    // Call the updated signDocument function in SignatureModule
    const signedCredential = await this.signatureModule.signDocument(
      ontologyVersion,
      credential,
      privateKeyPath,
      verificationMethod,
      options
    );
    return signedCredential;
  }

  async handleCsvBatchProcessing(executableParams) {
    const { csvData, output: defaultOutput = "./output" } = executableParams;
    
    // Check if csvData exists and has content
    if (!csvData || !Array.isArray(csvData) || csvData.length === 0) {
      console.log("⚠️  No CSV data provided or empty dataset. Skipping batch processing.");
      return;
    }
    
    console.log(`📊 Processing ${csvData.length} records...`);

    const shapesToLink = this.batchProcessingModule.identifyShapesToLink(csvData);
    
    // Check if shapes need VP creation with external credentials
    const hasVPCreation = csvData.some(row => row.createVP === true || row.externalCredentialPaths);
    
    // Check if there are any ServiceOffering shapes that need special handling
    const hasServiceOffering = csvData.some(row => row.shapeType === 'ServiceOffering');
    
    if (shapesToLink.length > 1 || hasVPCreation || hasServiceOffering) {
      if (shapesToLink.length > 1) {
        console.log(`🔗 Detected ${shapesToLink.length} related shapes requiring ID linking`);
      }
      if (hasVPCreation) {
        console.log(`🔗 Detected shapes requiring VP creation with external credentials`);
      }
      if (hasServiceOffering) {
        console.log(`🔗 Detected ServiceOffering shapes requiring special handling`);
      }
      return await this.batchProcessingModule.handleLinkedShapesBatch(executableParams, csvData, defaultOutput);
    }

    return await this.batchProcessingModule.processStandardBatch(executableParams, csvData, defaultOutput);
  }

}
