// Copyright 2025 NTT DATA Luxembourg
// SPDX-License-Identifier: Apache-2.0

import fs from 'fs';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import path from 'path';

// Function to convert CSV to Excel
function convertCsvToExcel(csvFilePath, excelFilePath) {
    try {
        console.log(`📖 Reading CSV file: ${csvFilePath}`);
        
        // Read the CSV file
        const csvData = fs.readFileSync(csvFilePath, 'utf8');
        
        console.log(`📊 Parsing CSV data...`);
        
        // Parse CSV data into array of objects
        const records = parse(csvData, {
            columns: true,
            skip_empty_lines: true
        });
        
        console.log(`📝 Found ${records.length} records`);
        
        // Create a new workbook
        const workbook = XLSX.utils.book_new();
        
        // Convert records to worksheet
        const worksheet = XLSX.utils.json_to_sheet(records);
        
        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
        
        console.log(`💾 Writing Excel file: ${excelFilePath}`);
        
        // Write the Excel file
        XLSX.writeFile(workbook, excelFilePath);
        
        console.log(`✅ Successfully converted CSV to Excel:`);
        console.log(`   Input: ${csvFilePath}`);
        console.log(`   Output: ${excelFilePath}`);
        
    } catch (error) {
        console.error('❌ Error converting CSV to Excel:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Main execution
const csvFilePath = './templates/complete-multi-value-template.csv';
const excelFilePath = './templates/complete-multi-value-template.xlsx';
console.log('🔄 Starting CSV to Excel conversion...');
console.log(`📁 Current working directory: ${process.cwd()}`);

// Check if CSV file exists
if (!fs.existsSync(csvFilePath)) {
    console.error(`❌ CSV file not found: ${csvFilePath}`);
    process.exit(1);
}

console.log(`📄 Found CSV file: ${csvFilePath}`);

// Convert the file
convertCsvToExcel(csvFilePath, excelFilePath);
