import * as jose from "jose";
import fs from "fs";
import { JsonWebSignature2020Signer } from "@gaia-x/json-web-signature-2020";
import { v4 as uuidv4 } from "uuid";
export class SignatureModule {
  constructor(outputManager) {
    this.outputManager = outputManager; // Use the output manager for key management
    // console.log("🔒 [SignatureModule] Initialized successfully.");
  }

  async signDocument(
    ontologyVersion,
    shape,
    privateKeyPath,
    verificationMethod,
    options = {}
  ) {
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
    // Step 2: Check if the shape has an existing proof
    if (shape.proof) {
      console.log(
        "\n🔄 Existing proof detected. Adding a new proof to the chain..."
      );
      signedData = await this.signCredentialWithExistingProofs(
        shape,
        privateKey,
        verificationMethod,
        ontologyVersion,
        options
      );
    } else {
      console.log(
        "🔍 No existing proof found. Proceeding with normal signing..."
      );
      signedData = await this.createSignedCredential(
        shape,
        privateKey,
        verificationMethod,
        ontologyVersion
      );
    }

    // console.log("✅ [SignatureModule] Document signed successfully.");
    return signedData;
  }

  // Helper function to generate a new proof
  async createSignedCredential(
    shape,
    privateKey,
    verificationMethod,
    ontologyVersion
  ) {
    if (ontologyVersion === "22.10 (Tagus)") {
      return await this.signWithJWS(shape, privateKey, verificationMethod);
    } else if (ontologyVersion === "24.06 (Loire)") {
      return await this.signWithJWT(shape, privateKey, verificationMethod);
    } else {
      throw new Error(`Unsupported ontology version: ${ontologyVersion}`);
    }
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

  async signWithJWS(data, privateKey, verificationMethod, algorithm = "EdDSA") {
    data.proof = {
      ...data.proof,
      id: uuidv4(), // this id can later be referenced as part of the chain proof
    };

    // console.log("data to sign", data);

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

  async signWithJWT(data, privateKey, verificationMethod, algorithm = "ES256") {
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

  async signCredentialWithExistingProofs(
    originalCredential,
    privateKey,
    verificationMethod,
    ontologyVersion,
    options
  ) {
    console.log("🔄 [signCredentialWithExistingProofs] Starting process...");
    let proofArray = [];

    // Convert proof to an array if it's a single object
    if (Array.isArray(originalCredential.proof)) {
      proofArray = [...originalCredential.proof];
      console.log("🔄 [signCredentialWithExistingProofs] Proof is an array.");
    } else {
      proofArray = [originalCredential.proof];
      console.log(
        "🔄 [signCredentialWithExistingProofs] Proof is a single object."
      );
    }

    // Remove existing proof from the credential before signing
    let credentialWithoutProof = { ...originalCredential };
    delete credentialWithoutProof.proof;
    console.log(
      "🔄 [signCredentialWithExistingProofs] Existing proof removed from credential."
    );

    // Validate previousProof if provided
    let matchingProofs = [];
    if (options.previousProof) {
      if (typeof options.previousProof === "string") {
        matchingProofs = proofArray.filter(
          (p) => p.id === options.previousProof
        );
        if (matchingProofs.length === 0) {
          throw new Error("PROOF_GENERATION_ERROR: Previous proof not found.");
        }
        console.log(
          "🔄 [signCredentialWithExistingProofs] Single previous proof validated."
        );
      } else if (Array.isArray(options.previousProof)) {
        matchingProofs = proofArray.filter((p) =>
          options.previousProof.includes(p.id)
        );
        if (matchingProofs.length !== options.previousProof.length) {
          throw new Error(
            "PROOF_GENERATION_ERROR: Some previous proofs not found."
          );
        }
        console.log(
          "🔄 [signCredentialWithExistingProofs] Multiple previous proofs validated."
        );
      }
    }

    // Attach matching previous proofs to the credential before signing
    credentialWithoutProof.proof =
      matchingProofs.length > 0 ? matchingProofs : undefined;
    console.log(
      "🔄 [signCredentialWithExistingProofs] Matching previous proofs attached."
    );

    // Generate a new signed credential
    const newSignedCredential = await this.createSignedCredential(
      credentialWithoutProof,
      privateKey,
      verificationMethod,
      ontologyVersion,
      options
    );
    console.log(
      "🔄 [signCredentialWithExistingProofs] New signed credential generated."
    );

    const newProof = newSignedCredential.proof;

    // STEP 1: Assign `id` to last proof if it doesn’t have one
    const lastProof = proofArray[proofArray.length - 1];
    if (!lastProof.id) {
      lastProof.id = "urn:uuid:" + uuidv4();
      console.log(`🆔 Assigned id to previous proof: ${lastProof.id}`);
    }

    // STEP 2: Assign `id` and `previousProof` to new proof
    newProof.id = "urn:uuid:" + uuidv4();
    newProof.previousProof = lastProof.id;

    console.log(`🆕 New proof id: ${newProof.id}`);
    console.log(`🔗 Linked to previousProof: ${newProof.previousProof}`);

    // STEP 3: Append new proof to the array
    proofArray.push(newProof);
    newSignedCredential.proof = proofArray;

    return newSignedCredential;
  }
}
