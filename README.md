# Heartland Road Atlas and Chicago Field Guide

Two map dashboards for planning trips from Champaign, IL:

* `index.html`: 446 museums, buildings, cultural sites and parks in Illinois, Indiana, Michigan, Minnesota, Wisconsin, Missouri, Kentucky and Tennessee, with driving times from Champaign and trip guides grouped by 2, 3, 4, 6 and more hours.
* `chicago.html`: 107 Chicago sites with distances from Union Station and one guide per part of the city.

## Run it

The pages read their data from `data/*.json`, so they must be served over HTTP (browsers block reading files from a page opened directly from disk).

```
cd heartland-atlas
python3 -m http.server 8000
```

Then open http://localhost:8000. To publish, copy the folder to any static web host (a university web space, GitHub Pages, Netlify, an Apache or nginx server). No build step is needed.

## Data

```
data/
  midwest.json        settings for the atlas page and the list of state files to load
  states/*.json       one file per state: its sites and the intros of its trip regions
  chicago.json        settings, sites and guides for the Chicago page
  references.json     every publication and website cited, shared by both pages
```

A state file looks like this:

```
{
 "state": "MI",
 "name": "Michigan",
 "regions": {"Detroit and Southeast Michigan": "Give Detroit two or three days..."},
 "sites": [
  {"name": "Detroit Institute of Arts", "cat": "museum", "region": "Detroit and Southeast Michigan",
   "lat": 42.3594, "lng": -83.0647, "desc": "...", "refs": ["downs", "eckert"],
   "url": "https://dia.org", "wiki": "Detroit Institute of Arts", "img": "File_name.jpg",
   "drive_min": 424, "drive_mi": 381}
 ]
}
```

* `cat` is one of `museum`, `arch`, `culture`, `nature`.
* `refs` are ids from `references.json`; add a new entry there for a new source.
* `wiki`, `img` and `url` can be `null`. `img` is a Wikimedia Commons file name.
* `drive_min` and `drive_mi` are optional. If you leave them out, the page estimates them from the straight-line distance.

Trip guides are built automatically: every distinct `region` becomes a guide, placed in the 2, 3, 4 or 6 hour group by the median driving time of its sites. A region can span several states (Louisville takes in Indiana sites, for example); its intro is read from whichever state file defines it first.

To add a state, create `data/states/ohio.json` in the same shape and add `"states/ohio.json"` to the `files` list in `data/midwest.json`. Its filter chip, sites, guides and references appear on their own.

## Sources

* Map tiles: OpenStreetMap contributors (standard tile server, light personal use).
* Driving times and road miles: OSRM routing on OpenStreetMap data, without traffic.
* Coordinates, article links and photos: Wikipedia and Wikimedia Commons, loaded live. Photo credits link to each file page with author and license.
* Site citations: the guidebooks, histories and institutional sources listed on the References page of each dashboard.
