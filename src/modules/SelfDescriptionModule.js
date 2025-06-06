import axios from "axios";
import yaml from "js-yaml";
import { v4 as uuid4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
export class SelfDescriptionModule {
  constructor(parameterManager) {
    this.parameterManager = parameterManager;
    this.ontologyUrls = {
      "22.10 (Tagus)":
        "https://registry.lab.gaia-x.eu/v1-staging/api/trusted-shape-registry/v1/shapes",
      "24.06 (Loire)":
        "https://registry.lab.gaia-x.eu/main/linkml/2406/types.yaml",
    };
    this.tagusImplementedShapesUrl =
      "https://registry.lab.gaia-x.eu/v1-staging/api/trusted-shape-registry/v1/shapes/implemented";
  }

  async fetchOntologyTypesAndProperties(version) {
    const url = this.ontologyUrls[version];
    if (!url) {
      throw new Error(`No URL configured for ontology version: ${version}`);
    }

    try {
      // console.log(`Fetching ontology types for version: ${version}...\n`);
      const response = await axios.get(url);
      const typesAndProperties = {};

      if (version === "22.10 (Tagus)") {
        return await this.handleTagusVersion(response.data, typesAndProperties);
      } else if (version === "24.06 (Loire)") {
        return this.handleLoireVersion(response.data, typesAndProperties);
      } else {
        throw new Error(`Unsupported ontology version: ${version}`);
      }
    } catch (error) {
      console.error(
        `Error fetching or parsing ontology for version ${version}:`,
        error
      );
      throw new Error("Failed to fetch ontology types.");
    }
  }

  async handleTagusVersion(data, typesAndProperties) {
    const allShapes = data["gx-trustframework"]?.["@graph"] || [];
    const implementedShapesResponse = await axios.get(
      this.tagusImplementedShapesUrl
    );
    let implementedShapes = implementedShapesResponse.data.sort();

    for (const shapeName of implementedShapes) {
      let shapeDetail;

      if (shapeName === "ServiceOfferingLabelLevel1") {
        // Special case: find shape where sh:targetClass has gx:ServiceOfferingLabelLevel1
        shapeDetail = allShapes.find(
          (s) =>
            s["sh:targetClass"]?.["@id"] === "gx:ServiceOfferingLabelLevel1"
        );
      } else {
        shapeDetail = allShapes.find((s) => s["@id"].includes(shapeName));
      }
      if (!shapeDetail) {
        // console.warn(
        //   `No shape detail found for implemented shape: ${shapeName}`
        // );
        continue;
      }

      const properties = Array.isArray(shapeDetail["sh:property"])
        ? shapeDetail["sh:property"]
        : [shapeDetail["sh:property"]];

      const { formattedProperties, preAssignedProperties } =
        this.formatTagusProperties(properties);

      typesAndProperties[shapeName] = {
        properties: formattedProperties,
        preAssignedProperties: preAssignedProperties,
      };
    }

    return typesAndProperties;
  }

  handleLoireVersion(data, typesAndProperties) {
    const yamlData = yaml.load(data, { schema: yaml.FAILSAFE_SCHEMA });
    let classes = yamlData.classes || {};
    // console.log("length before", Object.keys(classes).length);
    classes = Object.fromEntries(
      Object.entries(classes)
        .filter(([type, details]) => !details.abstract)
        .sort(([typeA], [typeB]) => typeA.localeCompare(typeB))
    );
    for (const [type, details] of Object.entries(classes)) {
      const attributes = details.attributes || {};
      typesAndProperties[type] = this.formatLoireAttributes(attributes);
    }

    console.log("Fetched Loire types and properties successfully.");
    return typesAndProperties;
  }

  formatTagusProperties(properties) {
    const formattedProperties = {};
    const preAssignedProperties = {}; // Store properties with sh:hasValue
    const PROPERTY_DESCRIPTION_OVERRIDES = {
      "gx:assignedTo":
        "The UUID of the service offering self-description to which the label level is assigned.",
      "gx:providedBy":
        "The DID of the legal participant self-description that provides the service offering.",
      "gx:maintainedBy":
        "The DID of participant maintaining the resource in operational condition.",
      "gx:hostedOn":
        "The UUID of the resource where the process is located (physical server, datacenter, availability zone).",
      "gx:instanceOf":
        "The UUID A virtual resource (normally a software resource) this process is an instance of.",
      "gx:tenantOwnedBy":
        "The UUID of participant with contractual relation with the resource",
    };
    const REQUIRED_PROPERTIES_OVERRIDE = [
      "gx:name",
      "gx:host",
      "gx:protocol",
      "gx:version",
      "gx:port",
      "gx:openAPI",
    ];
    // List of properties that should not be asked from the user
    const autoAssignedProperties = [
      "gx:assignedTo",
      "gx:exposedThrough",
      "gx:instanceOf",
      "gx:hostedOn",
      "gx:serviceAccessPoint",
    ];

    properties.forEach((property) => {
      const propertyName = property["sh:path"]["@id"];
      const hasValue = property["sh:hasValue"];

      // Skip user prompts for auto-assigned properties
      if (autoAssignedProperties.includes(propertyName)) {
        preAssignedProperties[propertyName] = "PREASSIGNED"; // Placeholder for later assignment
        return;
      }
      if (hasValue) {
        // Directly assign the hasValue
        preAssignedProperties[propertyName] = hasValue;
      } else {
        // Process properties without sh:hasValue
        let description = property["sh:description"] || propertyName;

        // Apply description override if available
        if (PROPERTY_DESCRIPTION_OVERRIDES[propertyName]) {
          description = PROPERTY_DESCRIPTION_OVERRIDES[propertyName];
        }
        formattedProperties[propertyName] = {
          description: description,
          range: property["sh:datatype"]
            ? property["sh:datatype"]["@id"].replace("xsd:", "").toLowerCase()
            : "string",
          required:
            REQUIRED_PROPERTIES_OVERRIDE.includes(propertyName) ||
            property["sh:minCount"] === 1, // force required=true if in override,
        };
      }
    });

    return { formattedProperties, preAssignedProperties };
  }

  formatLoireAttributes(attributes) {
    const formattedProperties = {};
    const preAssignedProperties = {}; // Store properties with sh:hasValue

    for (const [attrName, attrDetails] of Object.entries(attributes)) {
      const hasValue = attrDetails.hasValue;

      // Process properties without sh:hasValue
      const formattedAttrName = `gx:${attrName}`;
      formattedProperties[formattedAttrName] = {
        description: attrDetails.description || "",
        range: attrDetails.range || "string",
        required: attrDetails.required === "true",
      };
    }

    return {
      properties: formattedProperties,
      preAssignedProperties: preAssignedProperties,
    };
  }

  async generateShape(executableParams) {
    const { type, ontologyVersion, vcUrl } = executableParams;

    // console.log(
    //   `Generating shape for type: ${type} and version: ${ontologyVersion}...`
    // );

    // Step 1: Load shape metadata (hardcoded for now, can transition to SHACL)
    const typesAndProperties = await this.fetchOntologyTypesAndProperties(
      ontologyVersion
    );

    const { properties, preAssignedProperties } = typesAndProperties[type];

    // console.log(`📋 Properties for type '${type}':`, Object.keys(properties));
    // console.log(
    //   `📋 Pre-assigned properties (sh:hasValue):`,
    //   preAssignedProperties
    // );

    if (!properties) {
      throw new Error(
        `Type '${type}' is not valid for ontology version '${version}'.`
      );
    }
    // Step 2: Add predefined missing properties for specific types
    this.addMissingProperties(
      type,
      properties,
      preAssignedProperties,
      typesAndProperties
    );
    // console.log("properties", properties);
    // Step 3: Collect all attribute values from the user
    const collectedProperties =
      await this.parameterManager.collectAllProperties(
        properties,
        typesAndProperties
      );

    // console.log("collectedProperties", collectedProperties);
    // Filter out properties with empty values
    const filteredCollectedProperties = Object.fromEntries(
      Object.entries(collectedProperties).filter(([key, value]) => {
        if (key === "gx:policy") {
          // Explicitly allow empty strings for gx:policy
          return true;
        }
        return typeof value === "string" ? value.trim() !== "" : true;
      })
    );
    const finalProperties = {
      ...preAssignedProperties,
      ...filteredCollectedProperties,
    };

    console.log(`📋 Collected properties for type '${type}'`);

    // Step 4: Fit the collected data into the shape object
    const shapeObject = this.createVcShapeObject(
      executableParams,
      finalProperties
    );

    return shapeObject;
  }

  createVcShapeObject(executableParams, properties) {
    const { type, ontologyVersion, vcUrl, output, issuer } = executableParams;

    let id, credentialSubjectId;

    // For LegalParticipant, ServiceOffering, or ServiceOfferingLabelLevel1
    if (
      type === "LegalParticipant" ||
      type === "ServiceOffering"
    ) {
      // If vcUrl is provided, derive id using existing logic
      if (vcUrl) {
        if (output) {
          if (output.endsWith(".json")) {
            const fileName = path.basename(output);
            id = `${vcUrl}/${fileName}`;
          } else {
            id = `${vcUrl}/${type}.json`;
          }
        } else {
          id = `${vcUrl}/${type}.json`;
        }
        credentialSubjectId = id;
      } else {
        // vcUrl not provided, use uuid4 for id and credentialSubjectId
        id = uuid4();
        credentialSubjectId = id;
      }
    } else {
      // For all other types, use uuid4
      id = uuid4();
      credentialSubjectId = id;
    }

    let shapeObject = {
      id,
      type: ["VerifiableCredential", `gx:${type}`],
      issuer: issuer,
      credentialSubject: {
        id: credentialSubjectId,
        type: `gx:${type}`,
        ...properties,
      },
    };

    if (ontologyVersion === "22.10 (Tagus)") {
      shapeObject["@context"] = [
        "https://www.w3.org/2018/credentials/v1",
        "https://registry.lab.gaia-x.eu/development/api/trusted-shape-registry/v1/shapes/jsonld/trustframework#",
      ];
      shapeObject.issuanceDate = new Date().toISOString();
    } else if (ontologyVersion === "24.06 (Loire)") {
      shapeObject["@context"] = [
        "https://www.w3.org/ns/credentials/v2",
        "https://www.w3.org/ns/credentials/examples/v2",
      ];
      shapeObject.validFrom = new Date().toISOString();
    }

    return shapeObject;
  }

  async generateVpShape(executableParams, selectedFiles) {
    const { ontologyVersion, issuer } = executableParams;
    
    const serviceOfferingVCs = [];
    const legalParticipantVCs = [];
    const otherVCs = [];

    for (const file of selectedFiles) {
      const filePath = path.resolve(file);
      const fileContent = await fs.readFile(filePath, "utf8");

      const parsedContent = JSON.parse(fileContent);

      // Check if the credential includes either gx:LegalParticipant or gx:ServiceOffering
      if (
        parsedContent.type &&
        (parsedContent.type.includes("gx:LegalParticipant") ||
          parsedContent.type.includes("gx:ServiceOffering"))
      ) {
        // If gx:ServiceOffering is present (even if gx:LegalParticipant is also present), add it to serviceOfferingVCs
        if (parsedContent.type.includes("gx:ServiceOffering")) {
          serviceOfferingVCs.push(parsedContent);
        }
        // Otherwise, if only gx:LegalParticipant is present, add it to legalParticipantVCs
        else if (parsedContent.type.includes("gx:LegalParticipant")) {
          legalParticipantVCs.push(parsedContent);
        }
      } else {
        otherVCs.push(parsedContent);
      }
    }

    // Ordering:
    // - If gx:ServiceOffering exists, these VCs will be first.
    // - If only gx:LegalParticipant exists, these will be first.
    // - Then add all remaining credentials.
    const orderedCredentials = [
      ...serviceOfferingVCs,
      ...legalParticipantVCs,
      ...otherVCs,
    ];

    let vpShapeObject;

    if (ontologyVersion === "22.10 (Tagus)") {
      vpShapeObject = {
        id: uuid4(),
        type: ["VerifiablePresentation"],
        holder: issuer,
        verifiableCredential: orderedCredentials,
        "@context": ["https://www.w3.org/2018/credentials/v1"],
      };
    } else if (ontologyVersion === "24.06 (Loire)") {
      const envelopedCredentials = orderedCredentials.map((vc) => ({
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["EnvelopedVerifiableCredential"],
        id: "data:application/vc+jwt;" + vc,
      }));

      vpShapeObject = {
        type: ["VerifiablePresentation"],
        verifiableCredential: envelopedCredentials,
        "@context": [
          "https://www.w3.org/ns/credentials/v2",
          "https://www.w3.org/ns/credentials/examples/v2",
        ],
      };
    }

    return vpShapeObject;
  }
  addMissingProperties(
    type,
    properties,
    preAssignedProperties,
    typesAndProperties
  ) {
    const missingPropertiesMap = {
      LegalParticipant: {
        "gx:legalName": {
          description: "Legal binding name",
          range: "string",
          required: false,
        },
        "gx:description": {
          description: "Textual description of this organization",
          range: "string",
          required: false,
        },
      },
      ServiceOffering: {
        "gx:name": {
          description: "Name of the service offering",
          range: "string",
          required: false,
        },
        "gx:description": {
          description: "Description of the service offering",
          range: "string",
          required: false,
        },
      },
      ServiceAccessPoint: {
        "id": {
          description: "The URL of the service access point.",
          range: "string",
          required: true,
        },
      },
    };

    if (missingPropertiesMap[type]) {
      const predefinedProperties = missingPropertiesMap[type];
      for (const [key, value] of Object.entries(predefinedProperties)) {
        if (!properties[key]) {
          properties[key] = value;
        }
      }
    }
    // Compute the SHA-256 hash and assign it to the preAssignedProperties
    if (type === "LegalParticipant") {
      const termsAndConditionsText =
        typesAndProperties["GaiaXTermsAndConditions"].preAssignedProperties[
          "gx:termsAndConditions"
        ];
      // console.log("Terms And Conditions Text", termsAndConditionsText);
      const hash = createHash("sha256")
        .update(termsAndConditionsText)
        .digest("hex");
      // console.log("hash", hash);
      preAssignedProperties["gx-terms-and-conditions:gaiaxTermsAndConditions"] =
        hash;
    }
  }
}
