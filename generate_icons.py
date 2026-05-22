import os

def create_dummy_png(path):
    # A valid 1x1 transparent PNG byte array
    png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(png_data)

def create_dummy_ico(path):
    # A valid 1x1 ICO containing a 1x1 PNG byte array
    png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82'
    # ICO Header: Reserved (2), Type (2), Count (2)
    # Entry: Width (1), Height (1), Palette (1), Reserved (1), Planes (2), Bits (2), Size (4), Offset (4)
    ico_header = b'\x00\x00\x01\x00\x01\x00'
    size = len(png_data)
    entry = bytes([1, 1, 0, 0, 1, 0, 32, 0]) + size.to_bytes(4, 'little') + (22).to_bytes(4, 'little')
    
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(ico_header + entry + png_data)

def create_dummy_icns(path):
    # Minimal ICNS header and 1x1 ic08 block
    png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82'
    # ICNS Header: 'icns' (4), Length (4)
    # Block Header: 'ic08' (4), Length (4)
    block_size = len(png_data) + 8
    total_size = block_size + 8
    
    header = b'icns' + total_size.to_bytes(4, 'big')
    block = b'ic08' + block_size.to_bytes(4, 'big') + png_data
    
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(header + block)

if __name__ == '__main__':
    base_dir = os.path.join('tauri_app', 'src-tauri', 'icons')
    create_dummy_png(os.path.join(base_dir, '32x32.png'))
    create_dummy_png(os.path.join(base_dir, '128x128.png'))
    create_dummy_png(os.path.join(base_dir, '128x128@2x.png'))
    create_dummy_ico(os.path.join(base_dir, 'icon.ico'))
    create_dummy_icns(os.path.join(base_dir, 'icon.icns'))
    print("Successfully generated all dummy icons!")
