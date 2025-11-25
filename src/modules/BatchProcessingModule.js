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

import { v4 as uuid4 } from "uuid";

const CREDENTIAL_TYPES = {
  VP: "Verifiable Presentation (VP)"
};

const SHAPE_TYPES = {
  LEGAL_PARTICIPANT: "LegalParticipant",
  SERVICE_OFFERING: "ServiceOffering"
};

export class BatchProcessingModule {
  constructor(
    parameterManager,
    signatureModule,
    outputManager,
    legalRegistrationNumberModule,
    serviceOfferingModule,
    selfDescriptionModule
  ) {
    this.parameterManager = parameterManager;
    this.signatureModule = signatureModule;
    this.outputManager = outputManager;
    this.legalRegistrationNumberModule = legalRegistrationNumberModule;
    this.serviceOfferingModule = serviceOfferingModule;
    this.selfDescriptionModule = selfDescriptionModule;
  }

  /**
   * Identify if CSV data contains shapes that need ID linking or VP creation
   */
  identifyShapesToLink(csvData) {
    const shapeTypes = [...new Set(csvData.map(row => row.shapeType))];
    const linkableShapes = ['legalRegistrationNumber', 'GaiaXTermsAndConditions', SHAPE_TYPES.LEGAL_PARTICIPANT, SHAPE_TYPES.SERVICE_OFFERING];
    
    // Also check for shapes that need VP creation with external credentials
    const hasVPCreation = csvData.some(row => row.createVP === true || row.externalCredentialPaths);
    
    const linkedShapes = shapeTypes.filter(shape => linkableShapes.includes(shape));
    
    return linkedShapes.length > 0 || hasVPCreation ? linkedShapes : [];
  }

  /**
   * Create row parameters by merging executable params with row-specific values
   */
  createRowParams(executableParams, row, options = {}) {
    const baseParams = {
      ...executableParams,
      type: row.shapeType || (options.useExecutableType ? executableParams.type : row.shapeType),
      ontologyVersion: row.ontologyVersion || executableParams.ontologyVersion,
      credentialType: row.credentialType || executableParams.credentialType,
      shouldSign: row.shouldSign === 'true' || executableParams.shouldSign,
      vcUrl: row.vcUrl || executableParams.vcUrl,
      privateKeyPath: row.privateKeyPath || executableParams.privateKeyPath,
      verificationMethod: row.verificationMethod || executableParams.verificationMethod,
    };

    // Add issuer field if it exists in either the row or executableParams
    if (row.issuer || executableParams.issuer) {
      baseParams.issuer = row.issuer || executableParams.issuer;
    }

    return baseParams;
  }

  /**
   * Handle batch processing with automatic ID linking
   */
  async handleLinkedShapesBatch(executableParams, csvData, defaultOutput) {
    console.log(`🔗 Detected ServiceOffering shapes requiring special handling`);
    
    const results = [];
    
    // Process ServiceOffering shapes first
    await this.processServiceOfferingShapes(executableParams, csvData, defaultOutput, results);
    
    // Process regular linked shapes
    await this.processRegularLinkedShapes(executableParams, csvData, defaultOutput, results);
    
    // Create VPs from successfully generated shapes
    await this.createVerifiablePresentations(executableParams, defaultOutput, results);
    
    return results;
  }

  /**
   * Process ServiceOffering shapes separately
   */
  async processServiceOfferingShapes(executableParams, csvData, defaultOutput, results) {
    const serviceOfferingShapes = csvData.filter(row => row.shapeType === SHAPE_TYPES.SERVICE_OFFERING);
    
    // Process service offerings first
    for (const row of serviceOfferingShapes) {
      try {
        console.log(`🏗️  Processing ServiceOffering for entity: ${row.entityName || 'unknown'}...`);
        
        // Use row-specific output or default output
        const output = row.output || defaultOutput;
        if (row.output && row.output !== defaultOutput) {
          console.log(`📁 Using custom output directory: ${output}`);
        }
        
        const csvModeController = this.parameterManager.fileProcessor.setupCsvModeForRow(row, this.parameterManager);
        
        const rowParams = this.createRowParams(executableParams, row);

        // Use the ServiceOffering workflow
        console.log("🏗️  Creating ServiceOffering with all components...");
        const extractedProperties = await this.serviceOfferingModule.handleServiceOffering(rowParams);
        let vcShape = await this.serviceOfferingModule.createVcShapeObject(rowParams, extractedProperties);

        // Handle signing
        let finalShape = await this.handleCredentialSigning(vcShape, rowParams);

        // Save ServiceOffering
        const recordId = row.entityName || row.id || 'serviceoffering';
        const fileName = `ServiceOffering_${recordId}.json`;
        
        await this.outputManager.saveToFile(output, fileName, finalShape);
        
        console.log(`✅ ServiceOffering processed: ${fileName}`);
        results.push({ 
          entity: row.entityName || recordId,
          shapeType: SHAPE_TYPES.SERVICE_OFFERING,
          status: 'success', 
          fileName,
          data: row 
        });

        csvModeController.restore();

      } catch (error) {
        console.error(`❌ Error processing ServiceOffering: ${error.message}`);
        results.push({ 
          entity: row.entityName || 'unknown',
          shapeType: SHAPE_TYPES.SERVICE_OFFERING,
          status: 'error', 
          error: error.message,
          data: row 
        });
      }
    }
    
    // Create VPs for ServiceOffering if external credentials are provided
    await this.handleServiceOfferingVPs(executableParams, defaultOutput, results);
  }

  /**
   * Handle ServiceOffering VP creation with external credentials
   */
  async handleServiceOfferingVPs(executableParams, defaultOutput, results) {
    const successfulShapes = results.filter(r => r.status === 'success' && r.shapeType === SHAPE_TYPES.SERVICE_OFFERING);
    const shapesWithVP = successfulShapes.filter(r => r.data.externalCredentialPaths || r.data.createVP === 'true');
    
    if (shapesWithVP.length > 0) {
      console.log(`\n🔗 Creating ServiceOffering VPs with external credentials...`);
      for (const result of shapesWithVP) {
        try {
          // Use row-specific output or default output
          const output = result.data.output || defaultOutput;
          await this.createServiceOfferingVPWithExternalCredentials(result, executableParams, output, results);
        } catch (error) {
          console.error(`❌ Error creating ServiceOffering VP for ${result.entity}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Process regular linked shapes (non-ServiceOffering)
   */
  async processRegularLinkedShapes(executableParams, csvData, defaultOutput, results) {
    const regularShapes = csvData.filter(row => row.shapeType !== SHAPE_TYPES.SERVICE_OFFERING);
    
    // If there are no regular shapes to process, return early
    if (regularShapes.length === 0) {
      console.log(`\n📊 Processed: ${results.filter(r => r.status === 'success').length}/${results.length} successful`);
      return;
    }
    
    // Continue with regular linked shapes processing
    const groupedShapes = this.groupShapesByEntity(regularShapes);
    
    for (const [entityId, shapes] of Object.entries(groupedShapes)) {
      await this.processEntityShapes(entityId, shapes, executableParams, defaultOutput, results);
    }
  }

  /**
   * Process shapes for a single entity
   */
  async processEntityShapes(entityId, shapes, executableParams, defaultOutput, results) {
    // Determine the output directory for this entity group
    // Use the first row's output property, or default if none specified
    const entityOutput = shapes.find(row => row.output)?.output || defaultOutput;
    if (entityOutput !== defaultOutput) {
      console.log(`📁 Entity ${entityId} using custom output directory: ${entityOutput}`);
    }
    
    const generatedIds = {};
    const orderedShapes = this.orderShapesByDependency(shapes);
    
    for (const row of orderedShapes) {
      try {
        const csvModeController = this.parameterManager.fileProcessor.setupCsvModeForRow(row, this.parameterManager);
        
        const rowParams = this.createRowParams(executableParams, row);

        let vcShape = await this.processCredentialFromCsvWithLinking(rowParams, row, generatedIds, entityId);

        // Store generated ID for linking with role-specific keys
        this.storeGeneratedId(vcShape, row, generatedIds);

        // Handle signing
        let finalShape = await this.handleCredentialSigning(vcShape, rowParams);

        // Save credential with role-specific naming for dual LegalParticipant
        const recordId = row.entityName || row.id || 'record';
        const rolePrefix = row.credentialRole ? `_${row.credentialRole}` : '';
        const fileName = `${rowParams.type}${rolePrefix}_${recordId}.json`;
        
        await this.outputManager.saveToFile(entityOutput, fileName, finalShape);
        
        console.log(`✅ ${row.shapeType}${rolePrefix} processed: ${fileName}`);
        results.push({ 
          entity: entityId,
          shapeType: row.shapeType,
          credentialRole: row.credentialRole,
          status: 'success', 
          fileName,
          generatedId: row.credentialRole ? generatedIds[`${row.shapeType}_${row.credentialRole}`] : generatedIds[row.shapeType],
          data: row,
          output: entityOutput  // Store the actual output directory used
        });

        csvModeController.restore();

      } catch (error) {
        console.error(`❌ Error processing ${row.shapeType}: ${error.message}`);
        results.push({ 
          entity: entityId,
          shapeType: row.shapeType,
          credentialRole: row.credentialRole,
          status: 'error', 
          error: error.message,
          data: row 
        });
      }
    }
  }

  /**
   * Store generated ID for linking with role-specific keys
   */
  storeGeneratedId(vcShape, row, generatedIds) {
    if (vcShape?.credentialSubject?.id) {
      if (row.shapeType === SHAPE_TYPES.LEGAL_PARTICIPANT && row.credentialRole) {
        // Store dual LegalParticipant IDs with role-specific keys
        generatedIds[`${row.shapeType}_${row.credentialRole}`] = vcShape.credentialSubject.id;
      } else {
        generatedIds[row.shapeType] = vcShape.credentialSubject.id;
      }
    }
  }

  /**
   * Create Verifiable Presentations from successfully generated shapes
   */
  async createVerifiablePresentations(executableParams, defaultOutput, results) {
    const successfulResults = results.filter(r => r.status === 'success');
    
    console.log(`\n📊 Processed: ${successfulResults.length}/${results.length} successful`);
    
    // Check for ServiceOfferingWithVP shapes that need VP creation with external credentials
    await this.handleServiceOfferingWithVPCreation(executableParams, defaultOutput, successfulResults, results);
    
    // Handle regular dual VP creation for AllShapesWithDualLegalParticipant
    await this.handleDualVPCreation(executableParams, defaultOutput, successfulResults, results);
  }

  /**
   * Handle ServiceOffering VP creation with external credentials
   */
  async handleServiceOfferingWithVPCreation(executableParams, defaultOutput, successfulResults, results) {
    const serviceOfferingWithVP = successfulResults.filter(r => r.data.createVP === true);
    if (serviceOfferingWithVP.length > 0) {
      console.log(`\n🔗 Creating ServiceOffering VPs with external credentials...`);
      for (const result of serviceOfferingWithVP) {
        try {
          // Use the actual output directory from the result
          const output = result.output || defaultOutput;
          await this.createServiceOfferingVPWithExternalCredentials(result, executableParams, output, results);
        } catch (error) {
          console.error(`❌ Error creating ServiceOffering VP for ${result.entity}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Handle dual VP creation for AllShapesWithDualLegalParticipant
   */
  async handleDualVPCreation(executableParams, defaultOutput, successfulResults, results) {
    if (successfulResults.length >= 4) { // Now we need at least 4 basic shapes (dual LegalParticipant + 2 others)
      console.log(`\n🔗 Creating Verifiable Presentations from generated shapes...`);
      try {
        // Group successful results by entity
        const entitiesByEntity = this.groupResultsByEntity(successfulResults);

        // Create VPs for each entity based on available shapes
        for (const [entityId, entityResults] of Object.entries(entitiesByEntity)) {
          await this.createVPsForEntity(entityId, entityResults, executableParams, defaultOutput, results);
        }
      } catch (error) {
        console.error(`❌ Error creating VPs: ${error.message}`);
      }
    }
  }

  /**
   * Group successful results by entity
   */
  groupResultsByEntity(successfulResults) {
    const entitiesByEntity = {};
    successfulResults.forEach(result => {
      if (!entitiesByEntity[result.entity]) {
        entitiesByEntity[result.entity] = [];
      }
      entitiesByEntity[result.entity].push(result);
    });
    return entitiesByEntity;
  }

  /**
   * Create VPs for a specific entity
   */
  async createVPsForEntity(entityId, entityResults, executableParams, defaultOutput, results) {
    try {
      const shapesByType = {};
      entityResults.forEach(result => {
        const key = result.credentialRole ? `${result.shapeType}_${result.credentialRole}` : result.shapeType;
        shapesByType[key] = result;
      });

      // Determine the output directory for this entity (all shapes should have the same output)
      const entityOutput = entityResults[0]?.output || defaultOutput;

      // Check what type of VP creation is needed
      const hasLegalParticipantForVP = shapesByType.LegalParticipant_for_legal_participant_vp;
      const hasLegalParticipantForSO = shapesByType.LegalParticipant_for_service_offering_vp;
      const hasBasicShapes = shapesByType.GaiaXTermsAndConditions && 
                            shapesByType.legalRegistrationNumber;
      const hasServiceOffering = shapesByType.ServiceOffering;

      if (hasLegalParticipantForVP && hasBasicShapes) {
        // Create VP1: Legal Participant VP (using LegalParticipant with vcUrl)
        await this.createLegalParticipantVP(entityId, shapesByType, executableParams, entityOutput, results);
      }

      if (hasLegalParticipantForSO && hasBasicShapes && hasServiceOffering) {
        // Create VP2: Service Offering VP (using LegalParticipant with ID) - only if ServiceOffering exists
        await this.createServiceOfferingVP(entityId, shapesByType, executableParams, entityOutput, results);
      }
    } catch (error) {
      console.error(`❌ Error creating VPs for entity ${entityId}: ${error.message}`);
    }
  }

  /**
   * Generic VP creation method that handles common VP creation logic
   */
  async createVP(vpConfig, entityId, shapesByType, executableParams, output, results) {
    console.log(`\n${vpConfig.icon} Creating ${vpConfig.name} VP for entity ${entityId}...`);
    
    // Get primary shape data for VP params and signing
    const primaryShape = vpConfig.primaryShapeKey ? shapesByType[vpConfig.primaryShapeKey] : null;
    const shapeData = primaryShape ? primaryShape.data : (vpConfig.shapeData || {});
    
    // Build credential files array
    let credentialFiles;
    if (vpConfig.credentialFiles) {
      // Direct credential files provided (for external credentials case)
      credentialFiles = vpConfig.credentialFiles;
    } else {
      // Build from shapesByType (normal case)
      credentialFiles = vpConfig.credentialFileKeys.map(key => {
        const shape = shapesByType[key];
        return `${output}/${shape.fileName}`;
      });
    }

    // Optional: Log credentials being included
    if (vpConfig.logCredentials) {
      console.log(`📋 Including credentials in VP:`);
      credentialFiles.forEach((file, index) => {
        console.log(`   ${index + 1}. ${file}`);
      });
    }

    const vpParams = this.createVpParams(executableParams, shapeData);

    const vpShape = await this.selfDescriptionModule.generateVpShape(vpParams, credentialFiles);
    
    // Handle VP signing
    let finalVpShape = await this.handleVpSigning(vpShape, shapeData, executableParams, entityId, vpConfig.name);

    // Save VP
    const entityName = entityId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const vpFileName = `VP_${vpConfig.type}_${entityName}.json`;
    
    await this.outputManager.saveToFile(output, vpFileName, finalVpShape);
    
    console.log(`✅ ${vpConfig.name} VP created for entity ${entityId}: ${vpFileName}`);
    
    // Build result data with external credentials info if applicable
    const resultData = { type: `VP_${vpConfig.type}`, entityId };
    if (vpConfig.credentialFiles && vpConfig.shapeData?.externalCredentialPaths) {
      const credentialPaths = vpConfig.shapeData.externalCredentialPaths.split(';').map(path => path.trim());
      resultData.externalCredentials = credentialPaths.length;
    }
    
    results.push({
      entity: entityId,
      shapeType: `VP_${vpConfig.type}`,
      status: 'success',
      fileName: vpFileName,
      data: resultData
    });
  }

  /**
   * Create Legal Participant VP containing LegalParticipant (with vcUrl), GaiaXTermsAndConditions, and legalRegistrationNumber
   */
  async createLegalParticipantVP(entityId, shapesByType, executableParams, output, results) {
    // Use the LegalParticipant credential specifically created for Legal Participant VP (with vcUrl)
    const legalParticipantForVP = shapesByType.LegalParticipant_for_legal_participant_vp || shapesByType.LegalParticipant;
    
    const vpConfig = {
      icon: '🏛️ ',
      name: 'Legal Participant',
      type: 'LegalParticipant',
      primaryShapeKey: legalParticipantForVP === shapesByType.LegalParticipant_for_legal_participant_vp ? 'LegalParticipant_for_legal_participant_vp' : 'LegalParticipant',
      credentialFileKeys: [
        legalParticipantForVP === shapesByType.LegalParticipant_for_legal_participant_vp ? 'LegalParticipant_for_legal_participant_vp' : 'LegalParticipant',
        'GaiaXTermsAndConditions',
        'legalRegistrationNumber'
      ]
    };

    await this.createVP(vpConfig, entityId, shapesByType, executableParams, output, results);
  }

  /**
   * Create Service Offering VP containing ServiceOffering, LegalParticipant (with ID), GaiaXTermsAndConditions, and legalRegistrationNumber
   */
  async createServiceOfferingVP(entityId, shapesByType, executableParams, output, results) {
    // Use the LegalParticipant credential specifically created for Service Offering VP (with ID)
    const legalParticipantForSO = shapesByType.LegalParticipant_for_service_offering_vp || shapesByType.LegalParticipant;
    
    const vpConfig = {
      icon: '🎯',
      name: 'Service Offering',
      type: 'ServiceOffering',
      primaryShapeKey: 'ServiceOffering',
      credentialFileKeys: [
        'ServiceOffering',
        legalParticipantForSO === shapesByType.LegalParticipant_for_service_offering_vp ? 'LegalParticipant_for_service_offering_vp' : 'LegalParticipant',
        'GaiaXTermsAndConditions',
        'legalRegistrationNumber'
      ]
    };

    await this.createVP(vpConfig, entityId, shapesByType, executableParams, output, results);
  }

  /**
   * Create VP parameters object (extracted for reuse)
   */
  createVpParams(executableParams, shapeData) {
    return {
      ...executableParams,
      credentialType: CREDENTIAL_TYPES.VP,
      ontologyVersion: shapeData.ontologyVersion || executableParams.ontologyVersion,
      issuer: shapeData.issuer || executableParams.issuer || 'did:web:example.com'
    };
  }

  /**
   * Handle credential signing
   */
  async handleCredentialSigning(vcShape, rowParams) {
    if (rowParams.shouldSign) {
      return await this.signatureModule.signDocument(
        rowParams.ontologyVersion, vcShape, rowParams.privateKeyPath, rowParams.verificationMethod
      );
    }
    return vcShape;
  }

  /**
   * Handle VP signing logic (extracted for reuse)
   */
  async handleVpSigning(vpShape, shapeData, executableParams, entityId, vpType) {
    let finalVpShape = vpShape;
    
    // Check if VP is already signed
    const isVpAlreadySigned = vpShape.proof && (Array.isArray(vpShape.proof) ? vpShape.proof.length > 0 : true);
    
    // Determine if VP should be signed
    const shouldSignVp = shapeData.shouldSignVP === 'true' || 
                       shapeData.shouldSign === 'true' || 
                       executableParams.shouldSignVP || 
                       executableParams.shouldSign;
    
    // Get VP-specific private key path or fallback to general one
    const vpPrivateKeyPath = shapeData.vpPrivateKeyPath || 
                           shapeData.privateKeyPath || 
                           executableParams.vpPrivateKeyPath ||
                           executableParams.privateKeyPath;
    
    const vpVerificationMethod = shapeData.vpVerificationMethod || 
                               shapeData.verificationMethod ||
                               executableParams.vpVerificationMethod ||
                               executableParams.verificationMethod;
    
    if (shouldSignVp) {
      if (isVpAlreadySigned) {
        console.log(`🔄 ${vpType} VP for entity ${entityId} is already signed. Adding additional proof...`);
      } else {
        console.log(`✍️  Signing ${vpType} VP for entity ${entityId}...`);
      }
      
      if (!vpPrivateKeyPath) {
        console.warn(`⚠️  Warning: ${vpType} VP signing requested for entity ${entityId} but no private key path provided. VP will remain unsigned.`);
        console.warn(`💡 Tip: Add 'vpPrivateKeyPath' or 'privateKeyPath' column to your CSV for VP signing.`);
      } else {
        finalVpShape = await this.signatureModule.signDocument(
          shapeData.ontologyVersion || executableParams.ontologyVersion, 
          vpShape, 
          vpPrivateKeyPath, 
          vpVerificationMethod
        );
      }
    } else if (isVpAlreadySigned) {
      console.log(`✅ ${vpType} VP for entity ${entityId} is already signed and signing not requested.`);
    } else {
      console.log(`ℹ️  ${vpType} VP for entity ${entityId} will remain unsigned (signing not requested).`);
    }

    return finalVpShape;
  }

  /**
   * Create ServiceOffering VP with external credentials
   */
  async createServiceOfferingVPWithExternalCredentials(serviceOfferingResult, executableParams, output, results) {
    const entityId = serviceOfferingResult.entity;
    
    // Parse external credential paths from CSV data
    const externalPaths = serviceOfferingResult.data.externalCredentialPaths;
    if (!externalPaths) {
      throw new Error(`No external credential paths provided for entity ${entityId}`);
    }
    
    // Split the paths (semicolon-separated)
    const credentialPaths = externalPaths.split(';').map(path => path.trim());
    
    // Create a special VP config for external credentials
    const vpConfig = {
      icon: '🎯',
      name: 'ServiceOffering with External Credentials',
      type: 'ServiceOffering',
      primaryShapeKey: null, // No primary shape from shapesByType
      credentialFiles: [
        `${output}/${serviceOfferingResult.fileName}`, // ServiceOffering VC created in this run
        ...credentialPaths // External credentials (LegalParticipant, GaiaXTermsAndConditions, legalRegistrationNumber)
      ],
      shapeData: serviceOfferingResult.data, // Use the CSV data for VP params and signing
      logCredentials: true // Flag to log the credentials being included
    };

    await this.createVP(vpConfig, entityId, null, executableParams, output, results);
  }

  /**
   * Auto-group shapes by entity without requiring explicit entityId
   */
  groupShapesByEntity(csvData) {
    const linkableShapes = ['legalRegistrationNumber', 'GaiaXTermsAndConditions', SHAPE_TYPES.LEGAL_PARTICIPANT, SHAPE_TYPES.SERVICE_OFFERING];
    const hasLinkableShapes = csvData.some(row => linkableShapes.includes(row.shapeType));
    
    if (hasLinkableShapes) {
      const uniqueLegalNames = [...new Set(csvData.map(row => row.legalName).filter(Boolean))];
      const uniqueRegistrationNumbers = [...new Set(csvData.map(row => row.registrationNumber).filter(Boolean))];
      
      if (uniqueLegalNames.length <= 1 && uniqueRegistrationNumbers.length <= 1) {
        const autoEntityId = uniqueLegalNames[0] || uniqueRegistrationNumbers[0] || 'auto-grouped-entity';
        return { [autoEntityId]: csvData };
      }
    }
    
    // Fallback grouping
    const grouped = {};
    csvData.forEach(row => {
      const entityId = row.entityId || row.id || row.legalName || `default_${Date.now()}`;
      (grouped[entityId] ||= []).push(row);
    });
    
    return grouped;
  }

  /**
   * Order shapes by dependency
   */
  orderShapesByDependency(shapes) {
    const order = { 
      legalRegistrationNumber: 0, 
      GaiaXTermsAndConditions: 1, 
      LegalParticipant: 2, 
      ServiceOffering: 3 
    };
    return shapes.sort((a, b) => {
      const aOrder = order[a.shapeType] ?? 99;
      const bOrder = order[b.shapeType] ?? 99;
      
      // For LegalParticipant with same order, prioritize the one for Legal Participant VP first
      if (aOrder === bOrder && a.shapeType === SHAPE_TYPES.LEGAL_PARTICIPANT && b.shapeType === SHAPE_TYPES.LEGAL_PARTICIPANT) {
        if (a.credentialRole === 'for_legal_participant_vp') return -1;
        if (b.credentialRole === 'for_legal_participant_vp') return 1;
      }
      
      return aOrder - bOrder;
    });
  }

  /**
   * Auto-link previously generated IDs to enhanced CSV row
   */
  applyAutoLinking(enhancedCsvRow, generatedIds) {
    // Auto-link to previously generated IDs
    if (generatedIds.legalRegistrationNumber && !enhancedCsvRow.legalRegistrationNumber) {
      enhancedCsvRow.legalRegistrationNumber = generatedIds.legalRegistrationNumber;
    }
    if (generatedIds.GaiaXTermsAndConditions && !enhancedCsvRow.gaiaxTermsAndConditions) {
      enhancedCsvRow.gaiaxTermsAndConditions = generatedIds.GaiaXTermsAndConditions;
    }
  }

  /**
   * Process legal registration number credential (extracted to avoid duplication)
   */
  async processLegalRegistrationNumber(ontologyVersion, csvRow, errorContext) {
    const registrationType = csvRow.registrationType || 'vatID';
    const registrationNumber = csvRow.registrationNumber;
    
    if (!registrationNumber) {
      throw new Error(`Missing registrationNumber for ${errorContext}`);
    }

    const vcid = csvRow.vcid || uuid4();
    const credentialSubjectId = csvRow.credentialSubjectId || uuid4();
    
    return await this.legalRegistrationNumberModule.createLegalRegistrationNumberShape(
      ontologyVersion, vcid, credentialSubjectId, registrationType, registrationNumber
    );
  }

  /**
   * Process credential with automatic ID linking
   */
  async processCredentialFromCsvWithLinking(rowParams, csvRow, generatedIds, entityId) {
    const { type, ontologyVersion } = rowParams;
    let vcShape;

    if (type === "legalRegistrationNumber" || type === "LocalRegistrationNumber") {
      vcShape = await this.processLegalRegistrationNumber(ontologyVersion, csvRow, `entity ${entityId}`);

    } else if (type === "GaiaXTermsAndConditions") {
      vcShape = await this.selfDescriptionModule.generateShape(rowParams);
      
    } else if (type === SHAPE_TYPES.LEGAL_PARTICIPANT) {
      const enhancedCsvRow = { ...csvRow };
      
      // Auto-link to previously generated IDs (but only use the basic ones, not the role-specific ones)
      this.applyAutoLinking(enhancedCsvRow, generatedIds);
      
      const csvModeController = this.parameterManager.fileProcessor.setupCsvModeForRow(enhancedCsvRow, this.parameterManager);
      try {
        vcShape = await this.selfDescriptionModule.generateShape(rowParams);
      } finally {
        csvModeController.restore();
      }
      
    } else if (type === SHAPE_TYPES.SERVICE_OFFERING) {
      const enhancedCsvRow = { ...csvRow };
      
      // Auto-link to previously generated IDs
      this.applyAutoLinking(enhancedCsvRow, generatedIds);
      
      // Link to the LegalParticipant created for Service Offering VP (with ID)
      if (generatedIds.LegalParticipant_for_service_offering_vp && !enhancedCsvRow.providedBy) {
        enhancedCsvRow.providedBy = generatedIds.LegalParticipant_for_service_offering_vp;
      } else if (generatedIds.LegalParticipant && !enhancedCsvRow.providedBy) {
        enhancedCsvRow.providedBy = generatedIds.LegalParticipant;
      }
      
      const csvModeController = this.parameterManager.fileProcessor.setupCsvModeForRow(enhancedCsvRow, this.parameterManager);
      try {
        // Use the ServiceOffering workflow instead of basic one
        console.log("🏗️  Creating ServiceOffering with all components...");
        const extractedProperties = await this.serviceOfferingModule.handleServiceOffering(rowParams);
        vcShape = await this.serviceOfferingModule.createVcShapeObject(rowParams, extractedProperties);
      } finally {
        csvModeController.restore();
      }
      
    } else {
      vcShape = await this.selfDescriptionModule.generateShape(rowParams);
    }

    return vcShape;
  }

  /**
   * Process credential from CSV row without linking
   */
  async processCredentialFromCsv(rowParams, csvRow, recordNumber) {
    const { type, ontologyVersion } = rowParams;
    let vcShape;

    if (type === "legalRegistrationNumber" || type === "LocalRegistrationNumber") {
      vcShape = await this.processLegalRegistrationNumber(ontologyVersion, csvRow, `record ${recordNumber}`);

    } else if (type === SHAPE_TYPES.SERVICE_OFFERING) {
      // Use the ServiceOffering workflow for all ServiceOffering requests
      console.log("🏗️  Creating ServiceOffering with all components...");
      const extractedProperties = await this.serviceOfferingModule.handleServiceOffering(rowParams);
      vcShape = await this.serviceOfferingModule.createVcShapeObject(rowParams, extractedProperties);
      
    } else {
      vcShape = await this.selfDescriptionModule.generateShape(rowParams);
    }

    return vcShape;
  }

  /**
   * Process standard batch without linking
   */
  async processStandardBatch(executableParams, csvData, defaultOutput) {
    const results = [];
    
    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];
      
      try {
        const csvModeController = this.parameterManager.fileProcessor.setupCsvModeForRow(row, this.parameterManager);
        
        // Use row-specific output or default output
        const output = row.output || defaultOutput;
        if (row.output && row.output !== defaultOutput) {
          console.log(`📁 Record ${i + 1} using custom output directory: ${output}`);
        }
        
        const rowParams = this.createRowParams(executableParams, row, { useExecutableType: true });

        if (rowParams.credentialType === CREDENTIAL_TYPES.VP) {
          throw new Error("VP processing from CSV not yet implemented");
        }

        let vcShape = await this.processCredentialFromCsv(rowParams, row, i + 1);

        let finalShape = await this.handleCredentialSigning(vcShape, rowParams);

        const recordId = row.entityName || row.id || `record_${i + 1}`;
        const fileName = `${rowParams.type}_${recordId}.json`;
        
        await this.outputManager.saveToFile(output, fileName, finalShape);
        
        console.log(`✅ Record ${i + 1} processed: ${fileName}${output !== defaultOutput ? ` (saved to: ${output})` : ''}`);
        results.push({ record: i + 1, status: 'success', fileName, data: row, output });

        csvModeController.restore();

      } catch (error) {
        console.error(`❌ Error processing record ${i + 1}: ${error.message}`);
        results.push({ record: i + 1, status: 'error', error: error.message, data: row });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    console.log(`\n📊 Batch Summary: ${successCount}/${csvData.length} successful`);
    
    return results;
  }
}
