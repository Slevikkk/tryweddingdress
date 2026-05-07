#!/bin/bash
# Download more wedding dresses from Unsplash (free license)
# Using direct Unsplash photo download URLs with proper sizing

download() {
    local url="$1"
    local filename="$2"
    echo "Downloading $filename..."
    curl -sL "$url" -o "$filename"
    local size=$(stat -c%s "$filename" 2>/dev/null || echo 0)
    echo "  -> $filename: ${size} bytes"
    if [ "$size" -lt 1000 ]; then
        echo "  WARNING: File too small, likely failed"
    fi
}

# Mermaid style - various colors
# Ivory/champagne lace mermaid
download "https://images.unsplash.com/photo-1594463750939-ebb28c3f7f75?w=800&q=80" "dress_07_mermaid_champagne.jpg"

# Ball gown style - various colors
# White tulle ball gown
download "https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80" "dress_08_ballgown_white_tulle.jpg"

# Elegant fitted
download "https://images.unsplash.com/photo-1585241645927-c7a8e5840c42?w=800&q=80" "dress_09_fitted_elegant.jpg"

# A-line with sleeves
download "https://images.unsplash.com/photo-1550005809-91ad75fb315f?w=800&q=80" "dress_10_aline_sleeves.jpg"

# Classic white strapless
download "https://images.unsplash.com/photo-1616935425767-ba08b3bab09d?w=800&q=80" "dress_11_classic_white.jpg"

# Bohemian lace
download "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&q=80" "dress_12_boho_lace.jpg"

echo "Done downloading!"
