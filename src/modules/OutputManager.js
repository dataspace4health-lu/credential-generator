import fs from "fs";
import path from "path";

export class OutputManager {
  constructor() {
    this.keyDir = "./output/keys";
    this.privateKeyPath = path.join(this.keyDir, "privateKey.json");
    this.publicKeyPath = path.join(this.keyDir, "publicKey.json");
    // console.log("📂 [OutputManager] Initialized successfully.");
  }

  async saveKeys(publicKey, privateKey) {
    try {
      await fs.promises.mkdir(this.keyDir, { recursive: true });
      await fs.promises.writeFile(
        this.publicKeyPath,
        JSON.stringify(publicKey, null, 2)
      );
      await fs.promises.writeFile(
        this.privateKeyPath,
        JSON.stringify(privateKey, null, 2)
      );
      console.log("🔑 Keys saved successfully!");
    } catch (error) {
      console.error("❌ Error saving keys:", error);
    }
  }

  async loadKeys() {
    try {
      if (
        fs.existsSync(this.publicKeyPath) &&
        fs.existsSync(this.privateKeyPath)
      ) {
        const publicKey = JSON.parse(
          await fs.promises.readFile(this.publicKeyPath, "utf8")
        );
        const privateKey = JSON.parse(
          await fs.promises.readFile(this.privateKeyPath, "utf8")
        );
        console.log("🔑 Keys loaded successfully!");
        return { publicKey, privateKey };
      } else {
        console.log("🔑 No keys found, generating new ones...");
        return null;
      }
    } catch (error) {
      console.error("❌ Error loading keys:", error);
      return null;
    }
  }

  async saveToFile(outputPath, defaultFileName, data) {
    try {
      const filePath = outputPath.endsWith(".json")
        ? outputPath
        : path.join(outputPath, defaultFileName);

      if (!fs.existsSync(path.dirname(filePath))) {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      }
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
      console.log(`\n✅ File saved to: ${filePath}\n`);
    } catch (error) {
      console.error("❌ Error saving file:", error);
    }
  }

  async loadCredential(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const data = await fs.promises.readFile(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      console.error(`❌ Error loading credential: ${error.message}`);
      throw error;
    }
  }
}
