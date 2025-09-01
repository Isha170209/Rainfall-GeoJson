import os
import zipfile
import requests
import pandas as pd
import geopandas as gpd
import gdown
from shapely.geometry import Point
from datetime import datetime, timedelta
import json  # <-- Added for manifest

# === Download & Extract Shapefile if not present ===
GOOGLE_DRIVE_FILE_ID = "1ciHMHl-QrhXx7gydBmh4iWKaAWOsIWMM"
ZIP_PATH = "India_tehsils.zip"
EXTRACT_DIR = "shapefiles/India_tehsils"
shapefile_path = os.path.join(EXTRACT_DIR, "India_tehsils.shp")

# Create directory if not exists
if not os.path.exists(EXTRACT_DIR):
    os.makedirs(EXTRACT_DIR)

# Download and extract if shapefile doesn't exist
if not os.path.exists(shapefile_path):
    print("📥 Downloading shapefile from Google Drive...")
    gdown.download(f"https://drive.google.com/uc?id={GOOGLE_DRIVE_FILE_ID}", ZIP_PATH, quiet=False)
    print("📦 Extracting shapefile...")
    with zipfile.ZipFile(ZIP_PATH, 'r') as zip_ref:
        zip_ref.extractall(EXTRACT_DIR)
    os.remove(ZIP_PATH)
    print("✅ Shapefile ready.")

# === Date Setup ===
yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
rain_csv_path = f"data/rain_merged_{yesterday}.csv"

# === Output Paths ===
output_rain_geojson = f"data/{yesterday}.geojson"
output_tehsil_geojson = f"data/India_tehsils_clean.geojson"
manifest_path = "data/manifest.json"

# === Text Cleaning Function ===
def clean_text(text):
    return str(text).replace('>', 'A').replace('@', 'U').replace('|', 'I')\
                    .replace('<', 'a').replace('/', 'I').strip().title()

# === Load Rainfall Data ===
if not os.path.exists(rain_csv_path):
    raise FileNotFoundError(f"{rain_csv_path} not found. Run download_imd_data.py first.")

df = pd.read_csv(rain_csv_path)

# ✅ Keep ALL dates in the file (do not restrict to just yesterday)
df['DateTime'] = pd.to_datetime(df['DateTime'], errors='coerce').dt.strftime('%Y-%m-%d')
df = df.dropna(subset=['DateTime'])

# === Load Shapefile ===
if not os.path.exists(shapefile_path):
    raise FileNotFoundError(f"{shapefile_path} not found. Please check the shapefile path.")

maha = gpd.read_file(shapefile_path).to_crs(epsg=4326)

# === Identify and Clean Column Names ===
state_col = next((col for col in maha.columns if "state" in col.lower()), None)
district_col = next((col for col in maha.columns if "district" in col.lower()), None)
tehsil_col = next((col for col in maha.columns if "tehsil" in col.lower()), None)

if not all([state_col, district_col, tehsil_col]):
    raise ValueError("Shapefile must have State, District, and Tehsil columns.")

maha[state_col] = maha[state_col].apply(clean_text)
maha[district_col] = maha[district_col].apply(clean_text)
maha[tehsil_col] = maha[tehsil_col].apply(clean_text)

# === Save Cleaned Tehsil GeoJSON ===
maha.to_file(output_tehsil_geojson, driver='GeoJSON')
print(f"✅ Tehsil GeoJSON saved to: {output_tehsil_geojson}")

# === Join Rainfall Points to Tehsils ===
features = []

for _, row in df.iterrows():
    date = row['DateTime']
    for col in df.columns[1:]:
        try:
            latlon = col.replace(',', ' ').split()
            if len(latlon) != 2:
                continue
            lat, lon = map(float, latlon)
            rainfall = float(row[col])
            point = Point(lon, lat)

            pt_gdf = gpd.GeoDataFrame(geometry=[point], crs='EPSG:4326')
            joined = gpd.sjoin(pt_gdf, maha[[state_col, district_col, tehsil_col, 'geometry']],
                               how='left', predicate='within')

            features.append({
                'geometry': point,
                'Date': date,
                'Rainfall': rainfall,
                'Lat': lat,
                'Lon': lon,
                'State': joined[state_col].values[0] if not joined.empty else "N/A",
                'District': joined[district_col].values[0] if not joined.empty else "N/A",
                'Tehsil': joined[tehsil_col].values[0] if not joined.empty else "N/A"
            })
        except Exception:
            continue

# === Create Output GeoJSON ===
gdf = gpd.GeoDataFrame(features, crs='EPSG:4326')
gdf.to_file(output_rain_geojson, driver='GeoJSON')
print(f"✅ Rainfall GeoJSON saved to: {output_rain_geojson} with {len(gdf)} features.")

# === Create/Update Manifest JSON ===
dated_filename = f"{yesterday}.geojson"
dated_filepath = os.path.join("data", dated_filename)

# Ensure correct filename
if output_rain_geojson != dated_filepath:
    os.rename(output_rain_geojson, dated_filepath)

# Manifest only keeps "latest" and "updated"
manifest = {
    "latest": dated_filename,
    "updated": datetime.now().strftime("%Y-%m-%d")
}

with open(manifest_path, "w") as f:
    json.dump(manifest, f, indent=2)

print(f"📄 Manifest written with latest={dated_filename}, updated={manifest['updated']}")
