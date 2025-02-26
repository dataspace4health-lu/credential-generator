import axios from "axios";
import yaml from "js-yaml";
import { v4 as uuid4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { console } from "inspector";

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
    const implementedShapes = implementedShapesResponse.data.sort();

    for (const shapeName of implementedShapes) {
      const shapeDetail = allShapes.find((s) => s["@id"].includes(shapeName));
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

    properties.forEach((property) => {
      const propertyName = property["sh:path"]["@id"];
      const hasValue = property["sh:hasValue"];

      if (hasValue) {
        // Directly assign the hasValue
        preAssignedProperties[propertyName] = hasValue;
      } else {
        // Process properties without sh:hasValue
        formattedProperties[propertyName] = {
          description: property["sh:description"] || propertyName,
          range: property["sh:datatype"]
            ? property["sh:datatype"]["@id"].replace("xsd:", "").toLowerCase()
            : "string",
          required: property["sh:minCount"] === 1,
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
    this.addMissingProperties(type, properties);
    // console.log("properties", properties);
    // Step 3: Collect all attribute values from the user
    const collectedProperties =
      await this.parameterManager.collectAllProperties(properties);

    // console.log("collectedProperties", collectedProperties);
    // Filter out properties with empty values
    const filteredCollectedProperties = Object.fromEntries(
      Object.entries(collectedProperties).filter(([key, value]) =>
        typeof value === "string" ? value.trim() !== "" : true
      )
    );
    const finalProperties = {
      ...preAssignedProperties,
      ...filteredCollectedProperties,
    };

    // console.log(`📋 Collected properties for type '${type}':`, finalProperties);

    // Step 4: Fit the collected data into the shape object
    const shapeObject = this.createVcShapeObject(executableParams, finalProperties);

    return shapeObject;
  }

  createVcShapeObject(executableParams, properties) {
    const { type, ontologyVersion, vcUrl, output, issuer } = executableParams;
    
    let id, credentialSubjectId;
    
    if (type === "LegalParticipant") {
        if (output) {
          if (output.endsWith(".json")) {
            const fileName = path.basename(output).replace(".json", "");
            id = `${vcUrl}/${fileName}`;
          } else {
            id = `${vcUrl}/${type}`;
          }
        } else {
            id = `${vcUrl}/${type}`;
        }
        credentialSubjectId = id;
    } else {
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

  async generateVpShape(ontologyVersion, selectedFiles) {
    const verifiableCredentials = [];
    let legalParticipantVC = null;

    for (const file of selectedFiles) {
      const filePath = path.resolve(file);
      const fileContent = await fs.readFile(filePath, "utf8");

      const parsedContent = JSON.parse(fileContent);

        // Check if the credential contains "gx:LegalParticipant" in the "type" array
        if (parsedContent.type && parsedContent.type.includes("gx:LegalParticipant")) {
            legalParticipantVC = parsedContent;
        } else {
            verifiableCredentials.push(parsedContent);
        }
    }

    // If a legal participant VC was found, make sure it's the first in the array
    if (legalParticipantVC) {
      verifiableCredentials.unshift(legalParticipantVC);
    }
    // console.log("verifiableCredentials", verifiableCredentials);

    let vpShapeObject;

    if (ontologyVersion === "22.10 (Tagus)") {
      vpShapeObject = {
        id:  uuid4(),
        type: ["VerifiablePresentation"],
        verifiableCredential: verifiableCredentials,
        "@context": ["https://www.w3.org/2018/credentials/v1"],
      };
    } else if (ontologyVersion === "24.06 (Loire)") {
      const envelopedCredentials = verifiableCredentials.map((vc) => ({
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
      console.log("vpShapeObject", vpShapeObject);
    }

    return vpShapeObject;
  }
  addMissingProperties(type, properties) {
    console.log("Add missing properties for type:", type);
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
        "gx-terms-and-conditions:gaiaxTermsAndConditions": {
          description: "sha256 hash of the document",
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
  }
}
