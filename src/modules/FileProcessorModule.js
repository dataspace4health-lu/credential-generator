import fs from "fs";
import { parse } from "csv-parse";
import * as XLSX from "xlsx";

const SHAPE_TYPES = {
  LEGAL_PARTICIPANT: "LegalParticipant",
  SERVICE_OFFERING: "ServiceOffering",
  LEGAL_REGISTRATION_NUMBER: "legalRegistrationNumber",
  GAIAX_TERMS_AND_CONDITIONS: "GaiaXTermsAndConditions"
};

export class FileProcessorModule {
  constructor() {
    this.validOntologyVersions = ["22.10 (Tagus)", "24.06 (Loire)"];
    this.validCredentialTypes = [
      "Verifiable Credential (VC)",
      "Verifiable Presentation (VP)"
    ];
    this.validShapeTypes = [
      SHAPE_TYPES.LEGAL_PARTICIPANT,
      SHAPE_TYPES.LEGAL_REGISTRATION_NUMBER, 
      SHAPE_TYPES.SERVICE_OFFERING,
      SHAPE_TYPES.GAIAX_TERMS_AND_CONDITIONS
    ];
  }

  /**
   * Parse single-template CSV format and generate all required shapes
   */
  async parseSingleTemplateCsvFile(csvFilePath) {
    return new Promise((resolve, reject) => {
      const rawData = [];
      
      if (!fs.existsSync(csvFilePath)) {
        reject(new Error(`CSV file not found: ${csvFilePath}`));
        return;
      }

      const parser = parse({
        columns: true, // Use first row as header
        skip_empty_lines: true,
        trim: true
      });

      parser.on('data', (row) => {
        rawData.push(row);
      });

      parser.on('error', (error) => {
        reject(error);
      });

      parser.on('end', () => {
        try {
          // Transform single template data to all 3 shapes
          const results = this.generateAllShapesFromTemplate(rawData);
          console.log(`✅ Single template CSV file uploaded successfully: ${csvFilePath}`);
          console.log(`📊 Generated ${results.length} shapes from single template`);
          resolve(results);
        } catch (error) {
          reject(error);
        }
      });

      fs.createReadStream(csvFilePath).pipe(parser);
    });
  }

  /**
   * Generate all 3 shapes from a single template
   */
  generateAllShapesFromTemplate(rawData) {
    if (rawData.length === 0) {
      throw new Error("Empty CSV data");
    }

    const valueColumns = this.extractValueColumns(rawData);
    console.log(`🔍 Found ${valueColumns.length} value column(s): ${valueColumns.join(', ')}`);

    const allShapes = [];

    // Process each value column separately
    valueColumns.forEach((valueColumn, index) => {
      console.log(`🔄 Processing ${valueColumn}...`);
      
      const currentTemplateData = this.extractTemplateDataForColumn(rawData, valueColumn);
      const entitySuffix = this.generateEntitySuffix(valueColumn, index);
      const shapes = this.generateShapesForEntity(currentTemplateData, entitySuffix);
      
      allShapes.push(...shapes);
    });

    console.log(`� Generated ${allShapes.length} shapes from ${valueColumns.length} entities`);
    return allShapes;
  }

  /**
   * Extract value columns from raw data
   */
  extractValueColumns(rawData) {
    const headers = Object.keys(rawData[0]);
    return headers.filter(header => header !== 'Property' && header.trim() !== '');
  }

  /**
   * Extract template data for a specific value column
   */
  extractTemplateDataForColumn(rawData, valueColumn) {
    const templateData = {};
    for (const row of rawData) {
      const property = row.Property;
      const value = row[valueColumn];
      
      if (property && value !== undefined && value !== '') {
        templateData[property] = value;
      }
    }
    return templateData;
  }

  /**
   * Map CSV properties to shape-specific properties based on shapeName
   * This handles the mapping of generic properties like gx:name, gx:license, gx:policy
   * to specific properties based on the shape being processed
   */
  mapPropertiesForShape(templateData, shapeName) {
    if (!shapeName) return templateData;
    
    const mappedData = { ...templateData };
    
    // Define the property mappings based on shape name
    const shapePropertyMappings = {
      'DataResource': {
        'gx:name': 'dataResourceName',
        'gx:license': 'dataResourceLicense', 
        'gx:policy': 'dataResourcePolicy',
        'gx:description': 'dataResourceDescription',
        'gx:containsPII': 'dataResourceContainsPII'
      },
      'SoftwareResource': {
        'gx:name': 'softwareResourceName',
        'gx:license': 'softwareResourceLicense',
        'gx:policy': 'softwareResourcePolicy',
        'gx:description': 'softwareResourceDescription'
      },
      'ServiceAccessPoint': {
        'gx:name': 'serviceAccessPointName',
        'gx:host': 'serviceAccessPointHost',
        'gx:protocol': 'serviceAccessPointProtocol',
        'gx:version': 'serviceAccessPointVersion',
        'gx:port': 'serviceAccessPointPort',
        'gx:openAPI': 'serviceAccessPointOpenAPI',
        'gx:contractNotificationAdress': 'serviceAccessPointContractNotificationAddress'
      }
    };
    
    const mappings = shapePropertyMappings[shapeName];
    if (mappings) {
      // Apply the mappings - replace generic properties with shape-specific ones
      Object.entries(mappings).forEach(([genericProperty, specificProperty]) => {
        if (templateData[specificProperty]) {
          mappedData[genericProperty] = templateData[specificProperty];
          //console.log(`🔄 Mapped ${specificProperty} -> ${genericProperty} for ${shapeName}`);
        }
      });
    }
    
    return mappedData;
  }

  /**
   * Generate entity suffix from value column name
   */
  generateEntitySuffix(valueColumn, index) {
    const entityName = valueColumn.toLowerCase().replace('value', '') || (index + 1);
    return entityName === '' ? '' : `_${entityName}`;
  }

  /**
   * Generate shapes for a single entity based on shape type
   */
  generateShapesForEntity(templateData, entitySuffix) {
    const shapeType = templateData.shapeType || SHAPE_TYPES.LEGAL_PARTICIPANT;
    
    switch (shapeType) {
      case SHAPE_TYPES.SERVICE_OFFERING:
        return this.generateServiceOfferingShapes(templateData, entitySuffix);
      
      case 'AllShapes':
      case undefined:
        return this.generateAllShapes(templateData, entitySuffix);
      
      case 'AllShapesWithDualLegalParticipant':
        return this.generateAllShapesWithDualLegalParticipant(templateData, entitySuffix);
      
      case 'BaseCredentialsWithDualLegalParticipant':
        return this.generateBaseCredentialsWithDualLegalParticipant(templateData, entitySuffix);
      
      case 'ServiceOfferingWithVP':
        return this.generateServiceOfferingWithVP(templateData, entitySuffix);
      
      default:
        return this.generateBasicShapes(templateData, entitySuffix);
    }
  }

  /**
   * Generate comprehensive ServiceOffering shapes
   */
  generateServiceOfferingShapes(templateData, entitySuffix) {
    return [
      {
        ...templateData,
        entityName: `entity${entitySuffix}`,
        shapeType: SHAPE_TYPES.SERVICE_OFFERING,
        shouldSign: templateData.shouldSign || 'false',
        vcUrl: templateData.vcUrl || undefined,
        description: templateData.description || 'Comprehensive service offering with all components'
      }
    ];
  }

  /**
   * Generate all shapes including ServiceOffering
   */
  generateAllShapes(templateData, entitySuffix) {
    return [
      this.createLegalParticipantShape(templateData, entitySuffix),
      this.createGaiaXTermsShape(templateData, entitySuffix),
      this.createLegalRegistrationShape(templateData, entitySuffix),
      this.createServiceOfferingShape(templateData, entitySuffix)
    ];
  }

  /**
   * Generate all shapes with dual LegalParticipant credentials
   */
  generateAllShapesWithDualLegalParticipant(templateData, entitySuffix) {
    return [
      this.createLegalParticipantShape(templateData, entitySuffix, 'for_legal_participant_vp'),
      this.createLegalParticipantShape(templateData, entitySuffix, 'for_service_offering_vp', true),
      this.createGaiaXTermsShape(templateData, entitySuffix),
      this.createLegalRegistrationShape(templateData, entitySuffix),
      this.createServiceOfferingShape(templateData, entitySuffix)
    ];
  }

  /**
   * Generate base credentials with dual LegalParticipant (no ServiceOffering)
   */
  generateBaseCredentialsWithDualLegalParticipant(templateData, entitySuffix) {
    return [
      this.createLegalParticipantShape(templateData, entitySuffix, 'for_legal_participant_vp'),
      this.createLegalParticipantShape(templateData, entitySuffix, 'for_service_offering_vp', true),
      this.createGaiaXTermsShape(templateData, entitySuffix),
      this.createLegalRegistrationShape(templateData, entitySuffix)
    ];
  }

  /**
   * Generate ServiceOffering with VP (external credentials)
   */
  generateServiceOfferingWithVP(templateData, entitySuffix) {
    return [
      {
        ...templateData,
        entityName: `entity${entitySuffix}`,
        shapeType: SHAPE_TYPES.SERVICE_OFFERING,
        shouldSign: templateData.shouldSignServiceOffering || templateData.shouldSign || 'false',
        vcUrl: templateData.serviceOfferingUrl || templateData.vcUrl || undefined,
        description: templateData.serviceOfferingDescription || templateData.description || 'Service offering information',
        externalCredentialPaths: templateData.externalCredentialPaths || undefined,
        createVP: true
      }
    ];
  }

  /**
   * Generate basic shapes (default behavior)
   */
  generateBasicShapes(templateData, entitySuffix) {
    return [
      this.createLegalParticipantShape(templateData, entitySuffix),
      this.createGaiaXTermsShape(templateData, entitySuffix),
      this.createLegalRegistrationShape(templateData, entitySuffix)
    ];
  }

  /**
   * Create a LegalParticipant shape
   */
  createLegalParticipantShape(templateData, entitySuffix, credentialRole = null, forceIdGeneration = false) {
    return {
      ...templateData,
      entityName: `entity${entitySuffix}`,
      shapeType: SHAPE_TYPES.LEGAL_PARTICIPANT,
      credentialRole,
      shouldSign: templateData.shouldSignLegalParticipant || templateData.shouldSign || 'false',
      vcUrl: forceIdGeneration ? undefined : (templateData.legalParticipantUrl || templateData.vcUrl || undefined),
      description: this.getDescription(templateData, 'legalParticipant', credentialRole)
    };
  }

  /**
   * Create a GaiaXTermsAndConditions shape
   */
  createGaiaXTermsShape(templateData, entitySuffix) {
    return {
      ...templateData,
      entityName: `entity${entitySuffix}`,
      shapeType: SHAPE_TYPES.GAIAX_TERMS_AND_CONDITIONS,
      shouldSign: templateData.shouldSignGaiaXTerms || templateData.shouldSign || 'true',
      vcUrl: templateData.gaiaxTermsUrl || templateData.vcUrl || undefined,
      description: templateData.gaiaxDescription || 'Gaia-X Terms and Conditions compliance'
    };
  }

  /**
   * Create a LegalRegistrationNumber shape
   */
  createLegalRegistrationShape(templateData, entitySuffix) {
    return {
      ...templateData,
      entityName: `entity${entitySuffix}`,
      shapeType: SHAPE_TYPES.LEGAL_REGISTRATION_NUMBER,
      shouldSign: templateData.shouldSignLegalRegistration || 'false',
      vcUrl: templateData.legalRegistrationUrl || templateData.vcUrl || undefined,
      description: templateData.legalRegistrationDescription || 'Legal registration credential'
    };
  }

  /**
   * Create a ServiceOffering shape
   */
  createServiceOfferingShape(templateData, entitySuffix) {
    return {
      ...templateData,
      entityName: `entity${entitySuffix}`,
      shapeType: SHAPE_TYPES.SERVICE_OFFERING,
      shouldSign: templateData.shouldSignServiceOffering || templateData.shouldSign || 'false',
      vcUrl: templateData.serviceOfferingUrl || templateData.vcUrl || undefined,
      description: templateData.serviceOfferingDescription || templateData.description || 'Service offering information'
    };
  }

  /**
   * Get appropriate description based on shape type and role
   */
  getDescription(templateData, shapePrefix, credentialRole) {
    const baseDescription = templateData[`${shapePrefix}Description`] || templateData.description;
    
    if (credentialRole === 'for_legal_participant_vp') {
      return baseDescription || 'Legal participant information for VP';
    } else if (credentialRole === 'for_service_offering_vp') {
      return baseDescription || 'Legal participant information for Service Offering VP';
    }
    
    return baseDescription || 'Legal participant information';
  }

  /**
   * Parse Excel file and convert to single-template format
   * Supports Property-Value format in Excel files
   */
  async parseExcelFile(excelFilePath) {
    try {
      if (!fs.existsSync(excelFilePath)) {
        throw new Error(`Excel file not found: ${excelFilePath}`);
      }

      console.log(`📊 Reading Excel file: ${excelFilePath}`);
      
      // Read the Excel file as buffer first (better for bundled executables)
      const fileBuffer = fs.readFileSync(excelFilePath);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      
      // Get the first worksheet
      const sheetName = workbook.SheetNames[0];
      console.log(`📄 Using sheet: ${sheetName}`);
      
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON format (Property-Value pairs)
      const rawData = XLSX.utils.sheet_to_json(worksheet);
      
      if (rawData.length === 0) {
        throw new Error("Excel file is empty");
      }

      // Validate that this is Property-Value format
      const firstRow = rawData[0];
      const headers = Object.keys(firstRow);
      const hasPropertyColumn = headers.includes('Property');
      const hasValueColumns = headers.some(header => header !== 'Property' && header.trim() !== '');
      
      if (!hasPropertyColumn || !hasValueColumns) {
        throw new Error(`❌ Invalid Excel format. Expected 'Property' column and at least one value column, but found: ${headers.join(', ')}`);
      }

      console.log(`✅ Excel file processed successfully: ${excelFilePath}`);
      console.log(`📊 Found ${rawData.length} property-value pairs in Excel file`);
      
      // Generate all shapes from the template data
      const results = this.generateAllShapesFromTemplate(rawData);
      console.log(`📊 Generated ${results.length} shapes from Excel template`);
      
      return results;
    } catch (error) {
      console.error(`❌ Error processing Excel file: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if CSV or Excel file argument is provided and handle single-template format
   */
  async handleCsvInput(parameters) {
    if (parameters.csv) {
      console.log("📄 Template file detected for batch processing...");
      try {
        const filePath = parameters.csv;
        const fileExtension = filePath.toLowerCase().split('.').pop();
        
        let data;
        if (fileExtension === 'xlsx' || fileExtension === 'xls') {
          console.log("🔄 Processing Excel file in single-template format (Property-Value pairs, generates all 3 shapes)");
          data = await this.parseExcelFile(filePath);
        } else if (fileExtension === 'csv') {
          console.log("🔄 Processing single-template CSV format (Property-Value pairs, generates all 3 shapes)");
          data = await this.parseSingleTemplateCsvFile(filePath);
        } else {
          throw new Error(`❌ Unsupported file format: ${fileExtension}. Please use .csv, .xlsx, or .xls files.`);
        }
        
        parameters.csvData = data;
        parameters.isCsvMode = true;
        
        // Extract and validate credential types and ontology versions from data
        this.processCsvParameters(data, parameters);
        
        return parameters;
      } catch (error) {
        console.error(`❌ Error processing template file: ${error.message}`);
        throw error;
      }
    }
    return parameters;
  }

  /**
   * Get CSV value for a specific property, handling various naming conventions
   */
  getCsvValueForProperty(csvRow, property) {
    // Direct property match
    if (csvRow[property]) {
      return csvRow[property];
    }

    // Remove gx: prefix and check
    const withoutPrefix = property.replace('gx:', '');
    if (csvRow[withoutPrefix]) {
      return csvRow[withoutPrefix];
    }

    // Check snake_case version
    const snakeCase = withoutPrefix.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (csvRow[snakeCase]) {
      return csvRow[snakeCase];
    }

    // Check lowercase version
    if (csvRow[withoutPrefix.toLowerCase()]) {
      return csvRow[withoutPrefix.toLowerCase()];
    }

    return undefined;
  }

  /**
   * Override the parameter collection methods to use CSV data for a specific row
   */
  setupCsvModeForRow(csvRow, parameterManager) {
    // Store original methods
    const originalCollectAllProperties = parameterManager.collectAllProperties.bind(parameterManager);
    const originalAskForProperty = parameterManager.askForProperty.bind(parameterManager);
    const originalCollectRegistrationDetails = parameterManager.collectRegistrationDetails.bind(parameterManager);
    const originalHandleSigningKey = parameterManager.handleSigningKey.bind(parameterManager);

    // Override property collection to use CSV data
    parameterManager.askForProperty = async (property, constraints) => {
      //console.log(`🔍 Retrieving property '${property}' from CSV row...`);
      
      // Get the shapeName if available from the current execution context
      const shapeName = constraints.shapeName;
      
      // Apply property mapping based on shapeName if available
      let mappedRow = this.mapPropertiesForShape(csvRow, shapeName);

      // Special case for gx:termsAndConditions - calculate hash from URL
      if (property === 'gx:termsAndConditions') {
        // Get the URL from CSV
        const urlValue = this.getCsvValueForProperty(mappedRow, 'soTermsAndConditionsURL') ||
          this.getCsvValueForProperty(mappedRow, 'termsAndConditions_URL') ||
          this.getCsvValueForProperty(mappedRow, 'termsAndConditions');

        if (!urlValue) {
          console.warn('⚠️ No URL found for gx:termsAndConditions in CSV. Using default value.');
          return { id: "missing terms and conditions" };
        }

        let hash = '';
        try {
          const { createHash } = require('crypto');
          const response = await fetch(urlValue);
          if (!response.ok)
            throw new Error(`Failed to fetch URL: ${response.statusText}`);

          const termsAndConditionsText = await response.text(); // Get the text content
          hash = createHash("sha256")
            .update(termsAndConditionsText)
            .digest("hex"); // Compute SHA-256 hash
          
        } catch (error) {
          console.error(`❌ Error fetching URL: ${error.message}`);
          console.log(`⚠️ Please enter a reachable URL.`);
          // Fallback to calculating hash from URL string if content fetch fails
          const { createHash } = require('crypto');
          hash = createHash("sha256").update(urlValue).digest("hex");
          console.log(`📄 Using fallback: calculated hash from URL string instead`);
        }

        return {
          "gx:URL": urlValue,
          "gx:hash": hash
        };
      }

      const csvValue = this.getCsvValueForProperty(mappedRow, property);
      
      if (csvValue !== undefined && csvValue !== null && csvValue !== '') {
        // Handle Gaia-X criteria properties (P1.1.1, P1.1.2, etc.)
        if (property.match(/^gx:P[1-5]\.\d+\.\d+$/)) {
          // Look for detailed evidence fields in CSV
          const evidenceField = property + '_evidence';
          const websiteField = property + '_website';
          const pdfField = property + '_pdf';
          const reasonField = property + '_reason';
          
          const evidenceValue = this.getCsvValueForProperty(csvRow, evidenceField);
          const websiteValue = this.getCsvValueForProperty(csvRow, websiteField);
          const pdfValue = this.getCsvValueForProperty(csvRow, pdfField);
          const reasonValue = this.getCsvValueForProperty(csvRow, reasonField);
          
          // Build response object
          const response = {
            "gx:description": constraints.description || "Gaia-X compliance criterion",
            "gx:response": csvValue
          };
          
          // Only add evidence if website or PDF is provided
          if (websiteValue || pdfValue) {
            const evidence = {};
            if (websiteValue) evidence["gx:website"] = websiteValue;
            if (pdfValue) evidence["gx:pdf"] = pdfValue;
            response["gx:evidence"] = evidence;
          }
          
          // Add evidence description if provided
          if (evidenceValue) {
            response["gx:evidenceDescription"] = evidenceValue;
          }
          
          // Only add reason if response is "Not applicable"
          if (reasonValue && csvValue && csvValue.toLowerCase() === "not applicable") {
            response["gx:reason"] = reasonValue;
          }
          
          return response;
        }

        // Handle special property formats based on shape type
        if (property === 'gx:legalRegistrationNumber' || property === 'gx:gaiaxTermsAndConditions') {
          return { id: csvValue };
        }

        if (property === 'gx:headquarterAddress' || property === 'gx:legalAddress') {
          return { 'gx:countrySubdivisionCode': csvValue };
        }

        if (property === 'gx:providedBy' || property === 'gx:aggregationOfResources') {
          return { id: csvValue };
        }

        // Handle boolean values
        if (constraints.range === 'boolean') {
          return csvValue.toLowerCase() === 'true';
        }

        return csvValue;
      }

      // Throw error for missing required properties instead of providing defaults
     
      if (constraints.required) {
        throw new Error(`❌ Missing required property '${property}' in CSV row`);
      }
      
      
      return undefined;
    };

    // Override registration details collection for legal registration number
    parameterManager.collectRegistrationDetails = async () => {
      const registrationType = csvRow.registrationType;
      const registrationNumber = csvRow.registrationNumber;
      
      if (!registrationType) {
        throw new Error(`❌ Missing required 'registrationType' field in CSV row`);
      }
      
      if (!registrationNumber) {
        throw new Error(`❌ Missing required 'registrationNumber' field in CSV row`);
      }
      
      console.log(`📄 Using registration type from CSV: ${registrationType}`);
      console.log(`🔢 Using registration number from CSV: ${registrationNumber}`);
      
      return {
        registrationType,
        registrationNumber
      };
    };

    // Override signing key handling to use CSV data
    parameterManager.handleSigningKey = async (parameters) => {
      const useOwnKey = csvRow.useOwnKey;
      const privateKeyPath = csvRow.privateKeyPath;
      const verificationMethod = csvRow.verificationMethod;

      if (useOwnKey !== undefined) {
        parameters.useOwnKey = useOwnKey.toString().toLowerCase() === 'true';
        console.log(`🔑 Using useOwnKey from CSV: ${parameters.useOwnKey}`);
      } else {
        parameters.useOwnKey = false;
      }

      if (parameters.useOwnKey) {
        if (privateKeyPath && privateKeyPath.trim() !== '') {
          parameters.privateKeyPath = privateKeyPath.trim();
          console.log(`🔑 Using private key path from CSV: ${parameters.privateKeyPath}`);
        } else {
          throw new Error(`❌ Missing 'privateKeyPath' in CSV row when useOwnKey is true`);
        }

        if (verificationMethod && verificationMethod.trim() !== '') {
          parameters.verificationMethod = verificationMethod.trim();
          console.log(`🔑 Using verification method from CSV: ${parameters.verificationMethod}`);
        } else {
          // Generate default verification method if not provided
          parameters.verificationMethod = parameters.issuer + "#key-0";
          console.log(`🔑 Using default verification method: ${parameters.verificationMethod}`);
        }
      } else {
        console.log("🔑 Using default signing key...");
        parameters.privateKey = false;
        parameters.verificationMethod = parameters.issuer + "#key-0";
      }
    };

    // Return restore function
    return {
      restore: () => {
        parameterManager.collectAllProperties = originalCollectAllProperties;
        parameterManager.askForProperty = originalAskForProperty;
        parameterManager.collectRegistrationDetails = originalCollectRegistrationDetails;
        parameterManager.handleSigningKey = originalHandleSigningKey;
      }
    };
  }

  /**
   * Extract and validate credential types from CSV data
   * @param {Array} csvData - Array of CSV row objects
   * @returns {boolean} - True if all credential types are valid, throws error if invalid
   */
  validateCredentialTypesFromCsv(csvData) {
    // Extract unique credential types from CSV
    const credentialTypes = [...new Set(csvData.map(row => row.credentialType).filter(Boolean))];
    console.log(`📜 Found credential types in CSV: ${credentialTypes.join(', ')}`);
    
    // Validate credential types
    const invalidCredentialTypes = credentialTypes.filter(type => 
      !this.validCredentialTypes.includes(type)
    );
    if (invalidCredentialTypes.length > 0) {
      throw new Error(`❌ Invalid credential types found in CSV: ${invalidCredentialTypes.join(', ')}`);
    }
    
    return true;
  }

  /**
   * Process CSV data to extract and validate credential parameters
   */
  processCsvParameters(csvData, parameters) {
    console.log("🔍 Processing CSV parameters...");
    
    // Validate credential types
    this.validateCredentialTypesFromCsv(csvData);
    
    // Extract unique credential types from CSV
    const credentialTypes = [...new Set(csvData.map(row => row.credentialType).filter(Boolean))];
    console.log(`📜 Found credential types in CSV: ${credentialTypes.join(', ')}`);
    
    // Extract unique ontology versions from CSV
    const ontologyVersions = [...new Set(csvData.map(row => row.ontologyVersion).filter(Boolean))];
    console.log(`🌐 Found ontology versions in CSV: ${ontologyVersions.join(', ')}`);
    
    // Validate ontology versions
    const invalidOntologyVersions = ontologyVersions.filter(version => 
      !this.validOntologyVersions.includes(version)
    );
    if (invalidOntologyVersions.length > 0) {
      throw new Error(`❌ Invalid ontology versions found in CSV: ${invalidOntologyVersions.join(', ')}`);
    }
    
    // Extract unique shape types from CSV
    const shapeTypes = [...new Set(csvData.map(row => row.shapeType).filter(Boolean))];
    console.log(`📄 Found shape types in CSV: ${shapeTypes.join(', ')}`);
    
    // Validate shape types
    const invalidShapeTypes = shapeTypes.filter(type => 
      !this.validShapeTypes.includes(type)
    );
    if (invalidShapeTypes.length > 0) {
      throw new Error(`❌ Invalid shape types found in CSV: ${invalidShapeTypes.join(', ')}. Valid types are: ${this.validShapeTypes.join(', ')}`);
    }
    
    // Store the extracted parameters for later use
    parameters.csvCredentialTypes = credentialTypes;
    parameters.csvOntologyVersions = ontologyVersions;
    parameters.csvShapeTypes = shapeTypes;
    
    console.log("✅ CSV parameters validated successfully");  
  }
}
