try {
    console.log("Attempting to require ./index.js...");
    const functions = require('./index.js');
    console.log("Successfully required ./index.js");
    console.log("Exports:", Object.keys(functions));
} catch (error) {
    console.error("CRITICAL ERROR loading ./index.js:");
    console.error(error);
    process.exit(1);
}
