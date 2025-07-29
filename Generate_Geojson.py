import pandas as pd
import geopandas as gpd
from shapely.geometry import Point

# === File Paths ===
csv_path = "E:/IMD Weather Data Trial/Data/excel/India Rainfall_2024.csv"
shapefile_path = "E:/IMD Weather Data Trial/shpfile/India_tehsils.shp"

output_rain_geojson = "E:/IMD Weather Data Trial/Data/dashboard/india dashboard/India_rainfall_data_1.geojson"
output_tehsil_geojson = "E:/IMD Weather Data Trial/Data/dashboard/india dashboard/india_tehsils_1.geojson"

# === Replacement Rules ===
def clean_text(text):
    return (
        str(text)
        .replace('>', 'A')
        .replace('@', 'U')
        .replace('|', 'I')
        .replace('<', 'a')
        .replace('/', 'I')
        .strip()
        .title()
    )

# === Load Input Files ===
df = pd.read_csv(csv_path)
df['DateTime'] = pd.to_datetime(df['DateTime'], errors='coerce')
df = df.dropna(subset=['DateTime'])
df['DateTime'] = df['DateTime'].dt.strftime('%Y-%m-%d')

maha = gpd.read_file(shapefile_path).to_crs(epsg=4326)

# Detect column names
state_col = next((col for col in maha.columns if "state" in col.lower()), None)
district_col = next((col for col in maha.columns if "district" in col.lower()), None)
tehsil_col = next((col for col in maha.columns if "tehsil" in col.lower()), None)

if not all([state_col, district_col, tehsil_col]):
    raise ValueError("Shapefile must have State, District, and Tehsil columns.")

# Clean the shapefile text fields
maha[state_col] = maha[state_col].apply(clean_text)
maha[district_col] = maha[district_col].apply(clean_text)
maha[tehsil_col] = maha[tehsil_col].apply(clean_text)

# === Save Cleaned Tehsil Shapefile as GeoJSON ===
maha.to_file(output_tehsil_geojson, driver='GeoJSON')
print(f"✅ Tehsil GeoJSON saved to: {output_tehsil_geojson}")

# === Build All Rainfall Points ===
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
        except:
            continue

# === Save Rainfall Points as GeoJSON ===
gdf = gpd.GeoDataFrame(features, crs='EPSG:4326')
gdf.to_file(output_rain_geojson, driver='GeoJSON')
print(f"✅ Rainfall GeoJSON saved to: {output_rain_geojson} with {len(gdf)} features.")
