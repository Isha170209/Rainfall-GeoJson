import os
import zipfile
import requests
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
from datetime import datetime, timedelta

# === CONFIG ===
GOOGLE_DRIVE_FILE_ID = "1ciHMHl-QrhXx7gydBmh4iWKaAWOsIWMM"  # <-- Replace this with your actual file ID
ZIP_PATH = "India_tehsils.zip"
EXTRACT_DIR = "shapefiles/India_tehsils"
shapefile_path = os.path.join(EXTRACT_DIR, "India_tehsils.shp")

# === Download & Extract Shapefile if not present ===
def download_from_google_drive(file_id, destination):
    URL = "https://drive.google.com/uc?export=download"
    session = requests.Session()
    response = session.get(URL, params={'id': file_id}, stream=True)
    
    # Handle large file confirmation
    for key, value in response.cookies.items():
        if key.startswith('download_warning'):
            response = session.get(URL, params={'id': file_id, 'confirm': value}, stream=True)
    
    with open(destination, "wb") as f:
        for chunk in response.iter_content(32768):
            f.write(chunk)

def extract_zip(zip_path, extract_to):
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)

# Create directory if not exists
if not os.path.exists(EXTRACT_DIR):
    os.makedirs(EXTRACT_DIR)

# Download if shapefile not already present
if not os.path.exists(shapefile_path):
    print("📥 Downloading shapefile from Google Drive...")
    download_from_google_drive(GOOGLE_DRIVE_FILE_ID, ZIP_PATH)
    print("📦 Extracting shapefile...")
    extract_zip(ZIP_PATH, EXTRACT_DIR)
    os.remove(ZIP_PATH)
    print("✅ Shapefile ready.")

# === Date Setup ===
yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
rain_csv_path = f"data/rain_merged_{yesterday}.csv"

# === Output Paths ===
output_rain_geojson = f"data/India_rainfall_{yesterday}.geojson"
output_tehsil_geojson = f"data/India_tehsils_clean.geojson"

# === Text Cleaning Function ===
def clean_text(text):
    return str(text).replace('>', 'A').replace('@', 'U').replace('|', 'I')\
                    .replace('<', 'a').replace('/', 'I').strip().title()

# === Load Rainfall Data ===
if not os.path.exists(rain_csv_path):
    raise FileNotFoundError(f"{rain_csv_path} not found. Run download_imd_data.py first.")

df = pd.read_csv(rain_csv_path)
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
