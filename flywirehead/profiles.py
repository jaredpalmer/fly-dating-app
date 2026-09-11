import hashlib
import json


PEOPLE = [
    ("Juniper", "Fermentation sommelier", "Compost District", "A banana that has stopped trying.", "Find out whether the window is open.", "You wash all six hands.", "sage", "pear"),
    ("Clementine", "Citrus curator", "Fruit Bowl", "The peel is the best part. I will not be taking questions.", "Split an orange and a very small apartment.", "Someone who stays for the pulp.", "peach", "orange"),
    ("Opal", "Window-light enthusiast", "East Windowsill", "Golden hour, all afternoon.", "Stop flying toward things we cannot have.", "You know glass is a boundary.", "lavender", "window"),
    ("Fern", "Botanical illustrator", "Monstera Heights", "Rain collecting on a very large leaf.", "Get absolutely lost in a houseplant.", "A healthy respect for spiders.", "sage", "leaf"),
    ("Olive", "Picnic correspondent", "Gingham Gardens", "Arriving uninvited, impeccably dressed.", "Make a meal out of almost nothing.", "You bring something to the table.", "rose", "picnic"),
    ("Pearl", "Dewdrop architect", "Hydrangea Hill", "Seeing the entire garden in one drop.", "Build something temporary and beautiful.", "A light landing.", "sky", "dew"),
    ("Maple", "Sap researcher", "Orchard Row", "Taking the scenic route down a tree.", "Stick together. Figuratively, ideally.", "You have an exit plan for syrup.", "honey", "pear"),
    ("Poppy", "Pollen stylist", "Flower Market", "A little color on all six shoes.", "Overdress for a marigold.", "You notice the small things.", "rose", "flower"),
    ("Clover", "Freelance optimist", "North Lawn", "Finding a fourth leaf on the first try.", "Take a chance on the open door.", "Luck looks good on you.", "sage", "leaf"),
    ("Daphne", "Vinyl collector", "Kitchen Counter", "The hum of a refrigerator in B-flat.", "Start a very small band.", "You listen before you buzz.", "lavender", "window"),
    ("Honey", "Dessert critic", "Breakfast Nook", "A single forgotten crumb of cake.", "Leave a little room for dessert.", "You are sweet without being sticky.", "honey", "picnic"),
    ("Iris", "Color theorist", "Prism Terrace", "The green you only see from this side.", "See things a little differently.", "You have more than one perspective.", "lavender", "flower"),
    ("Hazel", "Orchard caretaker", "Apple Yard", "Windfalls. Both kinds.", "Make the most of a soft spot.", "Roots, but also wings.", "honey", "pear"),
    ("Daisy", "Morning person", "South Petal", "Being first to the warm patch.", "Watch an entire sunrise together.", "You show up when you say you will.", "peach", "flower"),
    ("Ruby", "Berry buyer", "Raspberry Lane", "A red that you can taste.", "Find a perfectly imperfect strawberry.", "You are not afraid of a little mess.", "rose", "berry"),
    ("Celeste", "Amateur astronomer", "Skylight Quarter", "That one star. No, the other one.", "Aim for the sky, avoid the skylight.", "You know when to change direction.", "sky", "window"),
    ("Mabel", "Bakery regular", "Crumb Corner", "The second day of a croissant.", "Turn a breadcrumb into a banquet.", "You save the last little piece.", "honey", "picnic"),
    ("Flora", "Garden guide", "Greenhouse", "A leaf I have not landed on yet.", "Take the long way through the basil.", "You stop to smell the compost.", "sage", "leaf"),
    ("Nectar", "Mixologist", "Blossom Bar", "Something floral, nothing artificial.", "Toast to a short and interesting life.", "You can hold your own droplet.", "peach", "flower"),
    ("Willow", "River observer", "Birdbath Bend", "A reflection that does not look like me.", "Sit still for a change.", "Comfortable silence. Occasional buzzing.", "sky", "dew"),
    ("Ginger", "Spice merchant", "Pantry Steps", "Making an entrance through the smallest gap.", "Add a little heat to this kitchen.", "You can take a tiny joke.", "peach", "orange"),
    ("Violet", "Poet in residence", "Lavender Walk", "A sentence with somewhere to land.", "Write something that outlives us.", "You mean what you buzz.", "lavender", "flower"),
    ("Alma", "Apple inspector", "Orchard Row", "A bruise is just the beginning.", "Find the beauty in getting older.", "You are past your green phase.", "sage", "pear"),
    ("Saffron", "Market explorer", "Sunlit Spice Rack", "Traveling three meters for a good meal.", "Get out of this room for a while.", "A sense of direction. Any direction.", "honey", "orange"),
    ("Bea", "Identity consultant", "Daisy Junction", "Being a fly named Bea. Yes, I know.", "Stop explaining ourselves to everyone.", "You read the whole profile.", "peach", "flower"),
    ("Luna", "Night-shift artist", "Porchlight Place", "The garden after everyone leaves.", "Find a light worth staying near.", "You are not just another moth.", "lavender", "window"),
    ("Margot", "Still-life model", "Ceramic Bowl", "Holding a pose for almost a second.", "Make something ordinary look extraordinary.", "You get my good side. All of them.", "rose", "pear"),
    ("Esme", "Rain forecaster", "Terracotta Terrace", "The moment before the first drop.", "Find somewhere dry together.", "You check the forecast before a picnic.", "sky", "dew"),
    ("Moss", "Ground-level journalist", "Fern Gully", "The stories everyone flies over.", "Keep each other grounded, occasionally.", "Curiosity without an agenda.", "sage", "leaf"),
    ("Peaches", "Stone-fruit specialist", "Summer Counter", "Being exactly as advertised.", "Catch the last good day of summer.", "You do not rush a good thing.", "peach", "orange"),
    ("Briar", "Hedge explorer", "Rosewood Edge", "Getting through a place that looks impossible.", "Take the path with a few thorns.", "Brave, not reckless.", "rose", "berry"),
    ("Goldie", "Sunbeam collector", "West Windowsill", "One more minute in the light.", "Follow the warm patch across the room.", "You make room beside you.", "honey", "window"),
    ("Sylvie", "Forest-floor scholar", "Mushroom Court", "A very deep conversation about decay.", "Turn an ending into a beginning.", "You are open to growth.", "sage", "leaf"),
    ("Petra", "Tiny landscape designer", "Pebble Path", "A stone with an excellent view.", "Build our own little corner of the world.", "You appreciate solid foundations.", "sky", "dew"),
    ("Rosie", "Jam enthusiast", "Preserve Lane", "Keeping something good around a little longer.", "Make a sweet story out of a mess.", "Your intentions are as clear as your wings.", "rose", "berry"),
    ("Wren", "Flight instructor", "Open Door District", "A turn so clean nobody notices it.", "Leave through the actual opening this time.", "You are willing to learn.", "lavender", "picnic"),
]

PALETTES = {
    "sage": ["#bdc9ae", "#e8e6cf", "#65774f", "#a76d32"],
    "peach": ["#e7b6a0", "#f7d9ba", "#b57958", "#c58b45"],
    "lavender": ["#bcb2cd", "#eee3df", "#79718b", "#9d7949"],
    "rose": ["#d2a5aa", "#f1d6c8", "#936675", "#b58545"],
    "sky": ["#afc7cd", "#e8e9da", "#668a87", "#a8844f"],
    "honey": ["#d4bd83", "#f4e4b9", "#948050", "#b87a36"],
}


def catalog():
    profiles = []
    for i, (name, job, district, simple, together, flag, palette, setting) in enumerate(PEOPLE):
        profiles.append({
            "id": name.lower(), "name": name, "adult_days": 5 + i * 7 % 17,
            "sex": "female", "species": "Drosophila melanogaster", "fictional": True,
            "job": job, "district": district, "distance_cm": 12 + i * 31 % 280,
            "intentions": ["A long-term thing. Relatively.", "A little spark, then see.", "My last first flight."][i % 3],
            "prompts": [{"question": "My simple pleasures", "answer": simple}, {"question": "Together we could", "answer": together}, {"question": "My biggest green flag", "answer": flag}],
            "photos": [{"id": f"{name.lower()}-{j}", "caption": ["A little introduction", "In my natural habitat", "One more good side"][j], "setting": setting if j == 0 else ["leaf", "window", "flower", "picnic"][(i + j) % 4], "seed": (i + 1) * 101 + j * 17} for j in range(3)],
            "palette": PALETTES[palette], "seed": i + 1,
            "tags": [district, ["Early riser", "Slow landings", "Food motivated", "Garden regular", "Window seat"][i % 5]],
        })
    return profiles


def catalog_hash():
    return hashlib.sha256(json.dumps(catalog(), sort_keys=True).encode()).hexdigest()


def account():
    return {"id": "f-001", "name": "Francis", "adult_days": 12, "sex": "male", "species": "Drosophila melanogaster", "job": "Full-time fly. Part-time experiment.", "district": "The Observation Chamber", "intentions": "Looking for a connection. I have 25.6 million.", "prompts": [{"question": "My most irrational fear", "answer": "A perfectly clean kitchen."}, {"question": "I am looking for", "answer": "Someone who makes all 166,700 neurons feel seen."}, {"question": "A fact about me that surprises people", "answer": "My decisions come with receipts."}]}
