import { MainController } from "./controllers/MainController.js";
import readline from "readline";

(async () => {
  try {
    console.log("Initializing the application...");

    // Instantiate the MainController
    const mainController = new MainController();

    // Pass command-line arguments (excluding "node" and "index.js")
    const args = process.argv.slice(2);

    // Run the workflow
    await mainController.run(args);

    console.log("Workflow completed successfully! 🎉\n");

    // After the main workflow completes
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Press Enter to exit...", () => {
      rl.close();
      process.exit(0);
    });
  } catch (error) {
    console.error("An error occurred:", error.message);
    process.exit(1); // Exit with error status
  }
})();
