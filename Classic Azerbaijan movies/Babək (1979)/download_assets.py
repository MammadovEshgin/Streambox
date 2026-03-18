import os
import requests
import re

# Movie folder
target_dir = r"c:\Users\e.a.mammadov\Desktop\Az movie posters\Babək (1979)"

# Asset list (Name, URL)
assets = [
    ("Eldar Quliyev", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/director_avatars/1744059420616-avatar"),
    ("Ənvər Məmmədxanlı", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/crew_avatars/1744059609635-avatar"),
    ("Rasim İsmayılov", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/crew_avatars/1744059652333-avatar"),
    ("Polad Bülbüloğlu", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/crew_avatars/1744059697950-avatar"),
    ("Mayıs Ağabəyov", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/crew_avatars/1744059731730-avatar"),
    ("Rasim Balayev", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/cast_avatars/1744059786237-avatar"),
    ("Həsənağa Turabov", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/cast_avatars/1744060225785-avatar"),
    ("Amaliya Pənahova", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/cast_avatars/1744060279411-avatar"),
    ("Tamara Yandiyeva", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/cast_avatars/1744060338581-avatar"),
    ("Şahmar Ələkbərov", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/cast_avatars/1744060445773-avatar"),
    ("Məmməd Verdiyev", "https://juwdqqbaozyptbuthbzp.supabase.co/storage/v1/object/public/cast_avatars/1744060482830-avatar")
]

def download_asset(name, url):
    # Clean name for filename
    safe_name = re.sub(r'[<>:"/\\|?*]', '', name).strip()
    file_path = os.path.join(target_dir, f"{safe_name}.jpg")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        response = requests.get(url, stream=True, timeout=15, headers=headers)
        if response.status_code == 200:
            with open(file_path, 'wb') as f:
                for chunk in response.iter_content(1024):
                    f.write(chunk)
            print(f"Downloaded asset: {safe_name}")
            return True
        else:
            print(f"Failed to download {name}: Status {response.status_code}")
    except Exception as e:
        print(f"Error downloading {name}: {e}")
    
    return False

if __name__ == "__main__":
    for name, url in assets:
        download_asset(name, url)
