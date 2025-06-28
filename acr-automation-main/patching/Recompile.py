import subprocess
import os

print("Unpacking")
subprocess.call(["npx", "asar", "e", "app.asar", "app"], shell=True) 

print("Patching")
if subprocess.call(["Patcher-localhost2020.exe", "app"], shell=True) != 0:
    print("Failed to patch source files")
    exit(-1)

print("Repacking")
subprocess.call(["npx", "asar", "p", "app", "app_patched.asar"], shell=True) 
