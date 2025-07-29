import os
import sys
import subprocess
import csv
from time import sleep
from datetime import datetime, timedelta

# Install missing packages (optional for local use; skip in GitHub Actions)
def install_if_missing(packages):
    for package in packages:
        try:
            __import__(package)
        except ImportError:
            print("Installing {}...".format(package))
            subprocess.check_call([sys.executable, "-m", "pip", "install", package])

required = ["imdlib", "pandas", "xarray"]
install_if_missing(required)

import imdlib as imd
import pandas as pd

# ==== Date Setup ====
yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
start_dy = end_dy = yesterday

# ==== Setup ====
variable = 'rain'
path = "data"  # Save everything inside the data folder (repo-local)

if not os.path.exists(path):
    os.makedirs(path)
    # Add a .gitkeep file to ensure Git tracks this folder
    with open(os.path.join(path, ".gitkeep"), "w") as f:
        f.write("This file ensures Git tracks the data folder.\n")

def download_rain_data(lat, lon, village_name, start_dy, end_dy, path):
    try:
        print(f"Downloading data for {village_name} ({lat}, {lon})...")
        imd.get_real_data(variable, start_dy, end_dy, file_dir=path)
        data = imd.open_real_data(variable, start_dy, end_dy, path)

        filename = f"rain_{village_name}.csv"
        file_path = os.path.join(path, filename)
        data.to_csv(file_path, lat=lat, lon=lon)
        print(f"Saved data for {village_name}: {file_path}")

    except Exception as e:
        print(f"Failed for {village_name} ({lat}, {lon}): {e}")

# ==== Read coordinates from CSV ====
csv_file = csv_file = "India Rainfall Grids.csv"  # Copy this CSV to the root of the repo

coordinates = []
with open(csv_file, 'r') as file:
    reader = csv.reader(file)
    next(reader)
    for row in reader:
        village_name = row[2]
        lat = float(row[3])
        lon = float(row[4])
        coordinates.append((village_name, lat, lon))

# ==== Process in slabs ====
slab_size = 5
total = len(coordinates)
print(f"Total villages: {total} | Downloading for {yesterday} | Processing in slabs of {slab_size}\n")

for i in range(0, total, slab_size):
    slab = coordinates[i:i + slab_size]
    print(f"--- Processing slab {i // slab_size + 1} ---")
    for village_name, lat, lon in slab:
        download_rain_data(lat, lon, village_name, start_dy, end_dy, path)
    print("Slab completed.\n")
    sleep(2)

# ==== Merge all CSVs into one ====
print("Merging all CSVs into one...")

merged_df = None

for filename in os.listdir(path):
    if filename.startswith("rain_") and filename.endswith(".csv"):
        file_path = os.path.join(path, filename)
        try:
            df = pd.read_csv(file_path)
            latlon_col = df.columns[1]
            df = df[['DateTime', latlon_col]]
            df.rename(columns={latlon_col: latlon_col.strip()}, inplace=True)

            if merged_df is None:
                merged_df = df
            else:
                merged_df = pd.merge(merged_df, df, on='DateTime', how='outer')
        except Exception as e:
            print(f"Failed to process {filename}: {e}")

if merged_df is not None:
    merged_csv_path = os.path.join(path, f"rain_merged_{yesterday}.csv")
    merged_df.to_csv(merged_csv_path, index=False)
    print(f"Merged CSV saved to: {merged_csv_path}")
else:
    print("No data merged.")
