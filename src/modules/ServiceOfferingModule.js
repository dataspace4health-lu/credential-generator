export class ServiceOfferingModule {
  constructor(selfDescriptionModule) {
    this.selfDescriptionModule = selfDescriptionModule;

    this.shapes = [
      "ServiceOffering",
      "SOTermsAndConditions",
      "ServiceOfferingLabelLevel1",
      "InstantiatedVirtualResource",
      "DataResource",
      "ServiceAccessPoint",
    ];
  }

  async handleServiceOffering(executableParams) {
    const { ontologyVersion, vcUrl } = executableParams;
    const credentialSubject = [];
    for (const type of this.shapes) {
      console.log(`\n✨Processing shape type: ${type}...\n`);
      var vcShape = await this.selfDescriptionModule.generateShape({
        ontologyVersion,
        type,
        vcUrl
      });
      credentialSubject.push(vcShape.credentialSubject);
    }

    return credentialSubject;
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
