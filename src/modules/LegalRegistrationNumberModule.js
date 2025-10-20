import fetch from "node-fetch";

export class LegalRegistrationNumberModule {
  constructor() {
    // console.log("✅ LegalRegistrationNumberModule initialized.");
    // this.baseUrl = "https://wizard.lab.gaia-x.eu/api/legalRegistrationNumber";
    this.ontologyUrls = {
      "22.10 (Tagus)":
        "https://registrationnumber.notary.lab.gaia-x.eu/v1/registrationNumber",
      "24.06 (Loire)":
        "https://registrationnumber.notary.lab.gaia-x.eu/main/registration-numbers",
    };
    this.defaultContext = [
      "https://registry.lab.gaia-x.eu/development/api/trusted-shape-registry/v1/shapes/jsonld/participant",
    ];
    this.clearingHouse = "registrationnumber.notary.lab.gaia-x.eu/v1-staging";
    this.validRegistrationTypes = ["leiCode", "vatID", "EORI", "EUID", "taxID"];
  }

  async createLegalRegistrationNumberShape(
    ontologyVersion,
    vcid,
    credentialSubjectId,
    registrationType,
    registrationNumber
  ) {
    console.log("📋 Generating legal registration number shape...");

    if (ontologyVersion === "22.10 (Tagus)") {
      return await this.handleTagusRequest(
        vcid,
        credentialSubjectId,
        registrationType,
        registrationNumber
      );
    } else if (ontologyVersion === "24.06 (Loire)") {
      return await this.handleLoireRequest(
        vcid,
        credentialSubjectId,
        registrationType,
        registrationNumber
      );
    } else {
      throw new Error(`❌ Unsupported ontology version: ${ontologyVersion}`);
    }
  }

  async handleTagusRequest(
    vcid,
    credentialSubjectId,
    registrationType,
    registrationNumber
  ) {
    const baseUrl = this.ontologyUrls["22.10 (Tagus)"];
    const body = {
      "@context": this.defaultContext,
      type: "gx:legalRegistrationNumber",
      id: vcid,
      [`gx:${registrationType}`]: registrationNumber,
    };
    // console.log("Body", JSON.stringify(body, null, 2));
    const url = `${baseUrl}VC?vcid=${encodeURIComponent(vcid)}`;
    // console.log(`📤 Sending POST request to ${url}...`);
    const response = await this.sendPostRequest(url, body);

    console.log(
      "📤 Legal registration number shape request sent successfully (Tagus)."
    );
    return response;
  }

  async handleLoireRequest(
    vcid,
    credentialSubjectId,
    registrationType,
    registrationNumber
  ) {
    const baseUrl = this.ontologyUrls["24.06 (Loire)"];
    const normalizedRegistrationType =
      this.normalizeRegistrationType(registrationType);

    const endpoint = `${baseUrl}/${normalizedRegistrationType}/${registrationNumber}`;
    const queryParams = `?vcId=${encodeURIComponent(
      vcid
    )}&subjectId=${encodeURIComponent(credentialSubjectId)}`;
    const url = `${endpoint}${queryParams}`;

    console.log(`📤 Sending GET request to ${url}...`);
    const response = await this.sendGetRequest(url);

    console.log(
      "✅ Registration number shape request sent successfully (Loire)."
    );
    return response;
  }

  async sendPostRequest(url, body) {
    while (true) {
      // Loop indefinitely until the request succeeds
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        // console.log("Response", response);

        if (!response.ok) {
          // console.error(`❌ Response status: ${response.status}`);
          throw new Error(
            `❌ Failed to generate legal registration number: ${response.statusText}`
          );
        }

        // If successful, return the response JSON
        return await response.json();
      } catch (error) {
        // console.error("❌ Error during POST request:", error.message);
        // console.log("🔄 Retrying in 15 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 15000)); // Wait for 15 seconds before retrying
      }
    }
  }

  async sendGetRequest(url) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/vc+ld+jwt" },
      });

      if (!response.ok) {
        throw new Error(
          `❌ Failed to generate legal registration number: ${response.statusText}`
        );
      }
      // console.log("Response", response.text());
      return await response.text();
    } catch (error) {
      console.error("❌ Error during GET request:", error.message);
      throw error;
    }
  }

  normalizeRegistrationType(registrationType) {
    const typeMapping = {
      leiCode: "lei-code",
      vatID: "vat-id",
      EORI: "eori",
      taxID: "tax-id",
      EUID: "euid",
    };

    return typeMapping[registrationType] || registrationType; // Use mapping or fallback to original
  }
}
