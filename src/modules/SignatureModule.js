import * as jose from "jose";
import fs from "fs";
import { JsonWebSignature2020Signer } from "@gaia-x/json-web-signature-2020";

export class SignatureModule {
  constructor(outputManager) {
    this.outputManager = outputManager; // Use the output manager for key management
    console.log("🔒 [SignatureModule] Initialized successfully.");
  }

  async signDocument(ontologyVersion, shape, privateKeyPath, verificationMethod) {
    // console.log("✍️  [SignatureModule] Signing document...");
    let privateKey;
    // Step 1: Use the provided key if available
    if (privateKeyPath) {
      console.log("🔑 Using provided private key for signing.");
      // privateKey = providedKey;
      const privateKeyContent = await fs.promises.readFile(
        privateKeyPath,
        "utf8"
      );
      privateKey = JSON.parse(privateKeyContent);
      console.log("🔑 Using provided private key.");
    } else {
      console.log("🔑 No provided key, using default or generating new one...");
      const keys = await this.getOrGenerateKeyPair();
      privateKey = keys.privateKey;
    }

    let signedData;
    if (ontologyVersion === "22.10 (Tagus)") {
      console.log("🔑 [Tagus] Signing with JWS...");
      signedData = await this.signWithJWS(shape, privateKey, verificationMethod );
    } else if (ontologyVersion === "24.06 (Loire)") {
      console.log("🔑 [Loire] Signing with JWT...");
      signedData = await this.signWithJWT(shape, privateKey, verificationMethod);
    } else {
      throw new Error(`Unsupported ontology version: ${ontologyVersion}`);
    }

    // console.log("✅ [SignatureModule] Document signed successfully.");
    return signedData;
  }
  async getOrGenerateKeyPair(algorithm = "ECDSA") {
    let keys = await this.outputManager.loadKeys();
    if (!keys) {
      // Generate new keys if not found
      // console.log("Before generateKeyPair..");
      // const { publicKey, privateKey } = await jose.generateKeyPair(algorithm);
      const { subtle } = crypto;
      const keyPair = await subtle.generateKey(
        {
          name: algorithm, // Adjust for EC algorithms
          namedCurve: "P-256", // Adjust this based on the algorithm
        },
        true, // ✅ Make the key extractable
        ["sign", "verify"]
      );
      const { publicKey, privateKey } = keyPair;
      const jwkPublic = await jose.exportJWK(publicKey);
      const jwkPrivate = await jose.exportJWK(privateKey);
      // console.log("jwkPrivate", jwkPrivate);
      // console.log("jwkPublic", jwkPublic);
      jwkPublic.kid = "did:web:dataspace4health.local#key-0";
      jwkPrivate.kid = "did:web:dataspace4health.local#key-0";

      // Save the keys
      await this.outputManager.saveKeys(jwkPublic, jwkPrivate);
      keys = { publicKey: jwkPublic, privateKey: jwkPrivate };
    }
    return keys;
  }

  async signWithJWS(data, privateKey, verificationMethod, algorithm = "ES256") {
    const signer = new JsonWebSignature2020Signer({
      privateKey: privateKey,
      privateKeyAlg: algorithm,
      verificationMethod: verificationMethod,
      // documentLoader: myDocumentLoader,
      safe: false,
    });

    const signedVC = await signer.sign(data);

    return signedVC;
  }

  async signWithJWT(data, privateKey, verificationMethod,algorithm = "ES256") {
    const type = data.type[0] === "VerifiableCredential" ? "vc" : "vp";
    console.log("data.type", data.type);
    privateKey.kid = verificationMethod;
    privateKey.iss = verificationMethod.split("#")[0];

    // console.log(jwk);

    // Generate a JWT token
    const jwt = await new jose.SignJWT(data)
      .setProtectedHeader({
        alg: algorithm,
        typ: type + "+ld+json+jwt",
        cty: type + "+ld+json",
        iss: privateKey.iss,
        kid: privateKey.kid,
      })
      // .setIssuer(config["NTT"]["issuer"])
      // .setIssuedAt()
      // .setExpirationTime("90d")
      .sign(privateKey);

    return jwt;
  }
}
