import json, re
from pathlib import Path
import geopandas as gpd
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection
import pycountry

ROOT = Path('/mnt/data/atlasclock')
PUBLIC = ROOT/'public'
SHP = Path('/opt/pyvenv/lib/python3.13/site-packages/pyogrio/tests/fixtures/naturalearth_lowres/naturalearth_lowres.shp')

# Natural Earth low-resolution country geometry bundled in the environment.
gdf = gpd.read_file(SHP)

# Normalize a few Natural Earth fixture ISO codes that are -99 in this older fixture.
iso3_fallback = {
    'Norway': 'NOR',
    'France': 'FRA',
    'N. Cyprus': 'CYP',
    'Somaliland': 'SOM',
    'Kosovo': 'XKX',
}

def iso3(row):
    v = row['iso_a3']
    if v and v != '-99':
        return v
    return iso3_fallback.get(row['name'], row['name'][:3].upper())

def project(lon, lat):
    x = (float(lon) + 180.0) / 360.0 * 1000.0
    y = (90.0 - float(lat)) / 180.0 * 500.0
    return x, y

def ring_path(coords):
    pts = [project(lon, lat) for lon, lat in coords]
    if not pts:
        return ''
    s = f'M {pts[0][0]:.3f},{pts[0][1]:.3f}'
    for x,y in pts[1:]:
        s += f' L {x:.3f},{y:.3f}'
    return s + ' Z'

def geom_path(geom):
    if geom is None or geom.is_empty:
        return ''
    if geom.geom_type == 'Polygon':
        parts = [ring_path(geom.exterior.coords)]
        parts += [ring_path(r.coords) for r in geom.interiors]
        return ' '.join(parts)
    if geom.geom_type == 'MultiPolygon':
        return ' '.join(geom_path(g) for g in geom.geoms)
    if geom.geom_type == 'GeometryCollection':
        return ' '.join(geom_path(g) for g in geom.geoms)
    return ''

def country_name(row):
    return str(row['name'])

# Build timezone map from the host's IANA tzdata territory table.
zone_file = Path('/usr/share/zoneinfo/zone1970.tab')
iso2_zones = {}
if zone_file.exists():
    for line in zone_file.read_text(encoding='utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        cols = line.split('\t')
        if len(cols) >= 3:
            for cc in cols[0].split(','):
                iso2_zones.setdefault(cc.upper(), []).append(cols[2].strip())

# Remove duplicate zones while preserving order.
for k,v in list(iso2_zones.items()):
    iso2_zones[k] = list(dict.fromkeys(v))

# Cities: verify their coordinates against Natural Earth and assign ISO3 when possible.
cities_path = PUBLIC/'cities.json'
cities = json.loads(cities_path.read_text(encoding='utf-8'))
city_country = {}
for city in cities:
    point = __import__('shapely').geometry.Point(float(city['longitude']), float(city['latitude']))
    matches = gdf[gdf.geometry.contains(point)]
    iso = None
    if len(matches):
        iso = iso3(matches.iloc[0])
    else:
        # Fallback from ISO-2 country code in the city dataset.
        try:
            c = pycountry.countries.get(alpha_2=city.get('countryCode',''))
            iso = c.alpha_3 if c else None
        except Exception:
            iso = None
    city['iso3'] = iso
    city_country[city['id']] = iso
cities_path.write_text(json.dumps(cities, ensure_ascii=False, indent=2), encoding='utf-8')

svg_parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500" preserveAspectRatio="none" role="img" aria-label="Interactive Natural Earth world map">',
    '<g class="graticule-layer" aria-hidden="true">',
]
# Subtle graticule for geographic orientation.
for lon in range(-180, 181, 30):
    x,_ = project(lon, 0)
    svg_parts.append(f'<line x1="{x:.3f}" y1="0" x2="{x:.3f}" y2="500"/>')
for lat in range(-60, 91, 30):
    _,y = project(0, lat)
    svg_parts.append(f'<line x1="0" y1="{y:.3f}" x2="1000" y2="{y:.3f}"/>')
svg_parts.append('</g><g class="country-layer">')

country_records = []
for _, row in gdf.iterrows():
    iso = iso3(row)
    geom = row.geometry
    if geom is None or geom.is_empty:
        continue
    name = country_name(row)
    p = geom.representative_point()
    centroid = geom.centroid
    x,y = project(p.x,p.y)
    cx,cy = project(centroid.x,centroid.y)
    try:
        c = pycountry.countries.get(alpha_3=iso)
        iso2 = c.alpha_2 if c else ''
    except Exception:
        iso2 = ''
    zones = iso2_zones.get(iso2, [])
    if not zones:
        # sensible local fallback for entities that have no explicit zone in zone1970.tab
        fallback_zone = 'Etc/UTC'
        if iso in {'ATA'}: fallback_zone='Antarctica/Troll'
        zones=[fallback_zone]
    city_ids = [c['id'] for c in cities if c.get('iso3') == iso]
    country_records.append({
        'id': iso,
        'name': name,
        'iso2': iso2,
        'timezones': zones,
        'point': {'latitude': round(float(p.y),6), 'longitude': round(float(p.x),6)},
        'centroid': {'latitude': round(float(centroid.y),6), 'longitude': round(float(centroid.x),6)},
        'mapPoint': {'x': round(float(x),3), 'y': round(float(y),3)},
        'cityIds': city_ids,
        'approximate': False,
    })
    d = geom_path(geom)
    safe_name = name.replace('&','&amp;').replace('"','&quot;')
    svg_parts.append(f'<path id="{iso}" data-country="{safe_name}" data-iso2="{iso2}" d="{d}" tabindex="0" aria-label="{safe_name}"/>')

svg_parts.append('</g></svg>')
(PUBLIC/'world.svg').write_text(''.join(svg_parts), encoding='utf-8')
(PUBLIC/'countries.json').write_text(json.dumps(country_records, ensure_ascii=False, indent=2), encoding='utf-8')

# Build a verification report.
report=[]
for c in cities:
    report.append({
        'city': c['name'], 'iso3': c.get('iso3'), 'lat': c['latitude'], 'lon': c['longitude'], 'timezone': c['timezone']
    })
(ROOT/'data'/'map-verification.json').write_text(json.dumps({
    'source':'Natural Earth low-resolution country geometry bundled with pyogrio fixture',
    'projection':'equirectangular / Plate Carrée',
    'viewBox':'0 0 1000 500',
    'countries':len(country_records),
    'cities':len(cities),
    'cityAssignments':report,
}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Generated {len(country_records)} country geometries and {len(cities)} verified city points')
print('world.svg bytes', (PUBLIC/'world.svg').stat().st_size)
