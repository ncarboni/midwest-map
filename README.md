# Heartland Road Atlas and Chicago Field Guide

Two map dashboards for planning trips from Champaign, IL:

* `index.html`: 383 museums, buildings, cultural sites and parks in Illinois, Indiana, Minnesota, Wisconsin, Missouri, Kentucky and Tennessee, with driving times from Champaign and trip guides grouped by 2, 3, 4 and more hours.
* `chicago.html`: 107 Chicago sites with distances from Union Station and one guide per part of the city.

## Run it

The pages read their data from `data/*.json`, so they must be served over HTTP (browsers block reading files from a page opened directly from disk).

```
cd heartland-atlas
python3 -m http.server 8000
```

Then open http://localhost:8000. To publish, copy the folder to any static web host (a university web space, GitHub Pages, Netlify, an Apache or nginx server). No build step is needed.

## Data

Each file in `data/` holds `config`, `sites`, `guides` and `references`. A site record looks like:

```
{"id": "r0", "name": "Krannert Art Museum", "cat": "museum", "state": "IL",
 "region": "Champaign-Urbana and East Central Illinois", "lat": 40.102, "lng": -88.2314,
 "desc": "...", "refs": ["wpaIL", "enjoyil"], "url": "https://kam.illinois.edu",
 "wiki": "Krannert Art Museum", "img": "File_name.jpg",
 "drive_min": 5, "drive_mi": 2, "air_mi": 0.7}
```

`cat` is one of `museum`, `arch`, `culture`, `nature`. `refs` point to ids in `references`. To add a site, append a record (give it a new id) and add its id to a guide's `sites` list if you want it in a trip guide.

## Sources

* Map tiles: OpenStreetMap contributors (standard tile server, light personal use).
* Driving times and road miles: OSRM routing on OpenStreetMap data, without traffic.
* Coordinates, article links and photos: Wikipedia and Wikimedia Commons, loaded live. Photo credits link to each file page with author and license.
* Site citations: the guidebooks, histories and institutional sources listed on the References page of each dashboard.
