import { v4 as uuid4 } from "uuid";
export class ServiceOfferingModule {
  constructor(selfDescriptionModule) {
    this.selfDescriptionModule = selfDescriptionModule;

    this.shapes = [
      "ServiceOffering",
      // "SOTermsAndConditions",
      "ServiceOfferingLabelLevel1",
      "DataResource",
      "SoftwareResource",
      "ServiceAccessPoint",
      "InstantiatedVirtualResource",
    ];

    // List of properties that will inherit values from previously created shapes
    this.preAssignedProperties = {
      ServiceOfferingLabelLevel1: ["gx:assignedTo"],
      DataResource: ["gx:exposedThrough"],
      InstantiatedVirtualResource: [
        "gx:instanceOf",
        "gx:hostedOn",
        "gx:serviceAccessPoint",
      ],
    };

    // Store values for inherited properties
    this.previousShapeIds = {};
  }

  async handleServiceOffering(executableParams) {
    const { ontologyVersion, vcUrl } = executableParams;
    const credentialSubjects = [];
    for (const type of this.shapes) {
      console.log(`\n✨Processing shape type: ${type}...\n`);
      var vcShape = await this.selfDescriptionModule.generateShape({
        ontologyVersion,
        type,
        vcUrl,
      });
      console.log("vcShape: ", vcShape);
      // Store the ID from the first shape (ServiceOffering)
      this.previousShapeIds[type] = vcShape.credentialSubject.id;

      // Automatically assign properties from the correct shape
      if (this.preAssignedProperties[type]) {
        for (const property of this.preAssignedProperties[type]) {
          let assignedId = null;

          // Assign the correct ID based on the shape type
          if (
            property === "gx:assignedTo" ||
            property === "gx:exposedThrough"
          ) {
            assignedId = this.previousShapeIds["ServiceOffering"];
          } else if (property === "gx:instanceOf") {
            assignedId = this.previousShapeIds["SoftwareResource"];
          } else if (property === "gx:hostedOn") {
            assignedId = this.previousShapeIds["DataResource"];
          } else if (property === "gx:serviceAccessPoint") {
            assignedId = this.previousShapeIds["ServiceAccessPoint"];
          }

          if (assignedId) {
            vcShape.credentialSubject[property] = { id: assignedId };
            console.log(
              `✅ ${property} automatically set to ${assignedId} for ${type}`
            );
          } else {
            console.warn(
              `⚠️ No ID found for ${property}. Cannot assign it for ${type}.`
            );
          }
        }
      }
      credentialSubjects.push(vcShape.credentialSubject);
    }
    // Add SOTermsAndConditions at the end
    this.appendSOTermsAndConditions(credentialSubjects);

    return credentialSubjects;
  }

  appendSOTermsAndConditions(credentialSubjects) {
    const serviceOffering = credentialSubjects.find(
      (s) => s.type === "gx:ServiceOffering"
    );

    if (!serviceOffering?.["gx:termsAndConditions"]) {
      console.warn(
        "⚠️ ServiceOffering does not have gx:termsAndConditions, skipping SOTermsAndConditions."
      );
      return;
    }

    const { "gx:URL": URL, "gx:hash": hash } =
      serviceOffering["gx:termsAndConditions"];

    const soTermsAndConditions = {
      id: uuid4(),
      type: "gx:SOTermsAndConditions",
      "gx:URL": {
        "gx:URL": URL,
        "gx:hash": hash,
      },
    };

    credentialSubjects.push(soTermsAndConditions);
    console.log("✅ Added SOTermsAndConditions shape at the end.");
  }
  async createVcShapeObject(executableParams, extractedProperties) {
    const { type, ontologyVersion, vcUrl, output, issuer } = executableParams;

    let id, credentialSubjectId;

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
      console.log("vcUrl is not provided");
      // vcUrl not provided, use uuid4 for id and credentialSubjectId
      id = uuid4();
      // credentialSubjectId = id;
    }

    let shapeObject = {
      id,
      type: ["VerifiableCredential", `gx:${type}`],
      issuer: issuer,
      credentialSubject: extractedProperties,
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
}
