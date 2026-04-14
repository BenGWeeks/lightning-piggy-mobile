#!/bin/bash

# Generate PDF documentation for Lightning Piggy Mobile
# This script generates the main technical solution document

echo "Lightning Piggy — Documentation Generator"
echo "=========================================="
echo ""

# Check if asciidoctor-pdf is installed
if ! command -v asciidoctor-pdf &> /dev/null; then
    echo "Error: asciidoctor-pdf is not installed"
    echo "Please install it with: sudo gem install asciidoctor-pdf"
    exit 1
fi

# Change to docs directory
cd "$(dirname "$0")"

# Generate Technical Solution Document
echo "Generating Technical Solution Document..."
asciidoctor-pdf \
    -a pdf-theme=lightning-piggy \
    -a pdf-themesdir=themes \
    -a pdf-fontsdir=themes \
    TECHNICAL_SOLUTION_DOCUMENT.adoc \
    -o TECHNICAL_SOLUTION_DOCUMENT.pdf

if [ $? -eq 0 ]; then
    echo "  Technical Solution Document generated successfully (TECHNICAL_SOLUTION_DOCUMENT.pdf)"
else
    echo "  Error generating Technical Solution Document"
    exit 1
fi

echo ""
echo "Documentation generation complete!"
echo "Generated files:"
echo "  - docs/TECHNICAL_SOLUTION_DOCUMENT.pdf"
