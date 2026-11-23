"""Normalización de nombres de alimentos, alias y valores de respaldo.

El PDF de la tabla está escrito con varias palabras "pegadas" (por ejemplo
"Atúnenagua", "Pandecaja", "Pechugadepollo"). Aquí se reconstruyen los nombres
canónicos y se resuelven los alias que usan los menús.
"""

from __future__ import annotations

import re
import unicodedata

# --------------------------------------------------------------------------
# utilidades
# --------------------------------------------------------------------------


def strip_accents(text: str) -> str:
    text = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def norm(text: str) -> str:
    """Minúsculas, sin acentos, signos convertidos en espacios."""
    text = strip_accents(str(text or "")).lower()
    text = text.replace("¼", " 1/4 ").replace("½", " 1/2 ").replace("¾", " 3/4 ")
    text = text.replace("⅓", " 1/3 ").replace("⅔", " 2/3 ").replace("⅛", " 1/8 ")
    text = re.sub(r"[^a-z0-9/]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def key(text: str) -> str:
    """Clave sin espacios, para comparar nombres pegados."""
    return re.sub(r"[^a-z0-9]", "", strip_accents(str(text or "")).lower())


# --------------------------------------------------------------------------
# Nombres canónicos (nospace -> nombre legible)
# --------------------------------------------------------------------------

CANONICAL_RU = [
    # verduras
    "Acelga cruda", "Apio crudo", "Brócoli crudo", "Cebolla", "Champiñón",
    "Chile jalapeño", "Chile poblano", "Chícharo", "Coliflor", "Espinaca",
    "Jícama", "Lechuga", "Nopal cocido", "Pepino", "Tomate", "Zanahoria cruda",
    # frutas
    "Ciruela roja", "Durazno", "Fresas enteras", "Guayaba", "Kiwi", "Mandarina",
    "Mango", "Manzana", "Melón picado", "Naranja", "Papaya picada", "Pera",
    "Piña rebanada", "Plátano", "Sandía", "Toronja", "Uva",
    # cereales sin grasa
    "Amaranto tostado natural", "Arroz cocido", "Arroz integral", "Avena cocida",
    "Camote cocido", "Elote desgranado", "Espagueti cocido", "Galletas María",
    "Galletas saladas", "Galletas Habanera", "Granola", "Hotcake integral",
    "Palomitas naturales", "Pan de caja", "Pan de hamburguesa", "Pan molido",
    "Papa cocida", "Pasta cocida", "Tortilla de maíz", "Tortilla de harina",
    # cereales con grasa
    "Barrita de granola s/az.", "Papas fritas", "Puré de papa", "Tamal",
    "Tostada", "Totopos de maíz",
    # leguminosas
    "Frijol cocido", "Garbanzo cocido", "Lenteja cocida", "Soya cocida",
    # leche
    "Leche descremada", "Yogurt natural light", "Lala 100 Proteí Plateada",
    "Jocoque", "Leche evaporada", "Leche", "Lala 100 Proteí Dorada",
    "Leche entera", "Leche clavel", "Leche liconsa", "Yogurt natural",
    # origen animal
    "Atún en agua", "Camarón cocido", "Clara de huevo", "Filete de pescado",
    "Filete de res", "Pechuga de pollo", "Requesón", "Salmón",
    "Arrachera", "Barbacoa", "Carne molida", "Jamón de pavo", "Pavo",
    "Pierna de puerco", "Pierna/Muslo de pollo S/P", "Queso fresco",
    "Queso panela", "Carne deshebrada", "Huevo", "Salchicha de pavo", "Sardinas",
    "Costilla de res", "Pulpa de res", "Queso amarillo", "Queso crema",
    # grasas
    "Aceite", "Aceite en aerosol", "Aceitunas", "Aderezo", "Aguacate", "Crema",
    "Crema para café", "Mantequilla", "Margarina", "Mayonesa", "Tocino",
    "Almendras", "Cacahuates", "Chorizo", "Crema de cacahuate", "Nuez",
    "Pistaches", "Semillas de calabaza", "Nutella",
    # azúcares
    "Azúcar", "Cajeta", "Gelatina", "Mermelada", "Miel", "Nieve", "Nutella",
    "Refresco",
]

CANONICAL = {key(name): name for name in CANONICAL_RU}

# Errores de captura del PDF original -> nombre legible
CANONICAL.update(
    {
        key("Semillas decalabazas"): "Semillas de calabaza",
        key("Nutellla"): "Nutella",
        key("Cremaparacafe"): "Crema para café",
    }
)


def canonical(name: str) -> str:
    """Devuelve el nombre legible de un alimento (arregla palabras pegadas)."""
    cleaned = re.sub(r"\s+", " ", str(name or "")).strip()
    return CANONICAL.get(key(cleaned), cleaned)


# --------------------------------------------------------------------------
# Gramos por porción cuando la tabla trae "—" en la columna GR.
# Valores prácticos (peso cocido/escurrido salvo indicación).
# --------------------------------------------------------------------------

_FALLBACK_RAW = {
    "Camarón cocido": 40,
    "Clara de huevo": 66,
    "Requesón": 40,
    "Pierna/Muslo de pollo S/P": 40,
    "Huevo": 50,
    "Aceite": 5,
    "Aceite en aerosol": 1,
    "Aceitunas": 30,
    "Crema para café": 15,
    "Margarina": 14,
    "Mayonesa": 5,
    "Tocino": 8,
    "Almendras": 12,
    "Gelatina": 65,
    "Leche liconsa": 120,
}

FALLBACK_GRAMS = {key(k): v for k, v in _FALLBACK_RAW.items()}


def fallback_grams(name: str):
    return FALLBACK_GRAMS.get(key(name))


# --------------------------------------------------------------------------
# Alimentos que no están en la tabla pero sí en los menús.
# (nombre, categoría, gramos por porción, medida casera)
# --------------------------------------------------------------------------

EXTRA_FOODS = [
    ("Queso cottage", "aoa_bajo", 60, "—"),
    ("Yogurt griego natural", "leche_descremada", 170, "3/4 taza"),
    ("Avena en hojuelas (cruda)", "cereales_sin_grasa", 20, "1/4 taza"),
    ("Wrap integral", "cereales_sin_grasa", 55, "1 pieza"),
    ("Betabel", "verduras", 80, "1/2 taza"),
    ("Espárragos", "verduras", 100, "1 taza"),
    ("Champiñones cocidos", "verduras", 93, "1 taza"),
    ("Jugo de verduras", "verduras", 130, "1/2 taza"),
    ("Pechuga de pavo", "aoa_muy_bajo", 30, "—"),
    ("Proteína en polvo", "aoa_muy_bajo", 30, "1 scoop"),
]

# --------------------------------------------------------------------------
# Alias: texto del menú -> alimento de la tabla
# --------------------------------------------------------------------------

ALIASES = {
    "huevo entero": "Huevo",
    "huevos": "Huevo",
    "huevo": "Huevo",
    "claras de huevo": "Clara de huevo",
    "clara de huevo": "Clara de huevo",
    "pechuga de pollo": "Pechuga de pollo",
    "pechuga a la plancha": "Pechuga de pollo",
    "pechuga de pollo asada": "Pechuga de pollo",
    "pollo": "Pechuga de pollo",
    "filete de salmon": "Salmón",
    "salmon": "Salmón",
    "atun": "Atún en agua",
    "filete de pescado": "Filete de pescado",
    "camaron": "Camarón cocido",
    "res": "Filete de res",
    "filete de res": "Filete de res",
    "filete de carne de res": "Filete de res",
    "carne de res": "Filete de res",
    "carne deshebrada": "Carne deshebrada",
    "carne de res deshebrada": "Carne deshebrada",
    "res deshebrada": "Carne deshebrada",
    "tinga de res": "Carne deshebrada",
    "carne en fajitas": "Pulpa de res",
    "fajitas de res": "Pulpa de res",
    "arrachera": "Arrachera",
    "barbacoa": "Barbacoa",
    "carne molida": "Carne molida",
    "pavo": "Pavo",
    "jamon de pavo": "Jamón de pavo",
    "salchicha de pavo": "Salchicha de pavo",
    "sardinas": "Sardinas",
    "queso panela": "Queso panela",
    "queso fresco": "Queso fresco",
    "queso amarillo": "Queso amarillo",
    "queso crema": "Queso crema",
    "requeson": "Requesón",
    "leche": "Leche",
    "leche entera": "Leche entera",
    "leche descremada": "Leche descremada",
    "yogurt natural": "Yogurt natural",
    "yogurt light": "Yogurt natural light",
    "arroz": "Arroz cocido",
    "arroz cocido": "Arroz cocido",
    "arroz integral": "Arroz integral",
    "pasta": "Pasta cocida",
    "pasta cocida": "Pasta cocida",
    "espagueti": "Espagueti cocido",
    "tortilla de maiz": "Tortilla de maíz",
    "tortillas de maiz": "Tortilla de maíz",
    "tortilla": "Tortilla de maíz",
    "tortillas": "Tortilla de maíz",
    "tortilla de harina": "Tortilla de harina",
    "papa": "Papa cocida",
    "papas cocidas": "Papa cocida",
    "pescado": "Filete de pescado",
    "pan integral": "Pan de caja",
    "pan de caja": "Pan de caja",
    "pan": "Pan de caja",
    "pan de hamburguesa": "Pan de hamburguesa",
    "tostada": "Tostada",
    "tostadas": "Tostada",
    "tostadas horneadas": "Tostada",
    "totopos horneado s/grasa": "Totopos de maíz",
    "totopos": "Totopos de maíz",
    "papa cocida": "Papa cocida",
    "papa en cubos": "Papa cocida",
    "papas": "Papa cocida",
    "pure de papa": "Puré de papa",
    "camote": "Camote cocido",
    "avena": "Avena en hojuelas (cruda)",
    "granola": "Granola",
    "galletas saladas": "Galletas saladas",
    "galletas maria": "Galletas María",
    "frijoles de la olla": "Frijol cocido",
    "frijol": "Frijol cocido",
    "frijoles": "Frijol cocido",
    "lentejas": "Lenteja cocida",
    "garbanzo": "Garbanzo cocido",
    "elote": "Elote desgranado",
    "chicharos": "Chícharo",
    "brocoli cocido": "Brócoli crudo",
    "brocoli": "Brócoli crudo",
    "zanahoria cocida": "Zanahoria cruda",
    "zanahoria": "Zanahoria cruda",
    "ejotes": "Chícharo",
    "nopales": "Nopal cocido",
    "espinaca": "Espinaca",
    "lechuga": "Lechuga",
    "tomate": "Tomate",
    "tomate en rodajas": "Tomate",
    "pepino": "Pepino",
    "jicama": "Jícama",
    "coliflor": "Coliflor",
    "champinones": "Champiñón",
    "aguacate": "Aguacate",
    "aceite de oliva": "Aceite",
    "aceite": "Aceite",
    "mantequilla": "Mantequilla",
    "margarina": "Margarina",
    "mayonesa": "Mayonesa",
    "crema": "Crema",
    "aderezo": "Aderezo",
    "almendras": "Almendras",
    "nueces": "Nuez",
    "nuez": "Nuez",
    "cacahuates": "Cacahuates",
    "pistaches": "Pistaches",
    "azucar": "Azúcar",
    "miel": "Miel",
    "mermelada": "Mermelada",
    "cajeta": "Cajeta",
    "naranja": "Naranja",
    "manzana": "Manzana",
    "platano": "Plátano",
    "uvas": "Uva",
    "uva": "Uva",
    "papaya picada": "Papaya picada",
    "papaya": "Papaya picada",
    "pina": "Piña rebanada",
    "pina rebanada": "Piña rebanada",
    "melon": "Melón picado",
    "melon picado": "Melón picado",
    "sandia": "Sandía",
    "kiwi": "Kiwi",
    "fresas": "Fresas enteras",
    "fresas enteras": "Fresas enteras",
    "durazno": "Durazno",
    "pera": "Pera",
    "guayaba": "Guayaba",
    "mandarina": "Mandarina",
    "mango": "Mango",
    "toronja": "Toronja",
    "ciruela": "Ciruela roja",
    "jugo de betabel y zanahoria": "Betabel",
    "betabel": "Betabel",
    "jocoque": "Jocoque",
    "leche evaporada": "Leche evaporada",
    "leche clavel": "Leche clavel",
}

# Palabras que no aportan y que aparecen en los menús
NOISE_WORDS = {
    "al", "gusto", "con", "y", "o", "de", "la", "el", "los", "las", "en",
    "cocido", "cocida", "cocidos", "cocidas", "asado", "asada", "asadas",
    "a", "plancha", "horneado", "horneadas", "horneada", "natural", "picado",
    "picada", "entero", "entera", "entero,", "light", "s/grasa", "rustica",
    "rústica", "frio", "frío", "pza", "pzas", "pieza", "piezas", "porcion",
    "medida", "casera", "cdita", "cdta", "cucharada", "cucharadita", "taza",
    "tazas", "g", "gr", "ml", "kg", "rebanada", "rebanadas", "sobre",
}
