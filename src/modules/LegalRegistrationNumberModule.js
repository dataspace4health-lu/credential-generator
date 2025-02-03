import fetch from "node-fetch";

export class LegalRegistrationNumberModule {
  constructor() {
    console.log("✅ LegalRegistrationNumberModule initialized.");
    this.baseUrl = "https://wizard.lab.gaia-x.eu/api/legalRegistrationNumber";
    this.defaultContext = [
      "https://registry.lab.gaia-x.eu/development/api/trusted-shape-registry/v1/shapes/jsonld/trustframework#",
    ];
    this.clearingHouse = "registrationnumber.notary.lab.gaia-x.eu/v1-staging";
    this.validRegistrationTypes = ["leiCode", "vatID", "EORI", "EUID", "taxID"];
  }

  async createLegalRegistrationNumberShape(
    vcid,
    credentialSubjectId,
    registrationType,
    registrationNumber
  ) {
    console.log("📋 Generating legal registration number shape...");

    // Build the values object for the request
    const values = {
      "@context": this.defaultContext,
      type: "gx:legalRegistrationNumber",
      id: credentialSubjectId,
      [`gx:${registrationType}`]: registrationNumber,
    };

    const body = {
      stored: false,
      clearingHouse: this.clearingHouse,
      values,
    };

    console.log("📤 Sending request to generate legal registration number...");
    const response = await this.sendRequest(vcid, body);

    console.log("✅ Legal registration number shape generated successfully.");
    return response;
  }
  
  async sendRequest(vcid, body) {
    const url = `${this.baseUrl}?vcid=${encodeURIComponent(vcid)}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to generate legal registration number: ${response.statusText}`
        );
      }

      const jsonResponse = await response.json();
      return jsonResponse;
    } catch (error) {
      console.error("❌ Error during API request:", error.message);
      throw error;
    }
  }
}
