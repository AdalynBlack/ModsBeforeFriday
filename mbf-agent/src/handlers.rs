use std::collections::HashMap;
use std::io::Cursor;

use crate::download_file;
use crate::{axml::AxmlReader, patching, zip::ZipFile};
use crate::external_res::CoreModsError;
use crate::manifest::ManifestInfo;
use crate::mod_man::ModManager;
use crate::requests::{AppInfo, CoreModsInfo, ModModel, Request, Response};
use anyhow::{anyhow, Context, Result};
use log::{error, info, warn};

pub fn handle_request(request: Request) -> Result<Response> {
    match request {
        Request::GetModStatus => handle_get_mod_status(),
        Request::Patch => handle_patch(),
        Request::SetModsEnabled {
            statuses
        } => run_mod_action(statuses),
        Request::QuickFix => handle_quick_fix(),
        Request::Import { from_path } => handle_import(from_path),
        Request::RemoveMod { id } => handle_remove_mod(id),
    }
}

fn run_mod_action(statuses: HashMap<String, bool>) -> Result<Response> {
    let mut mod_manager = ModManager::new();
    mod_manager.load_mods().context("Failed to load installed mods")?;

    for (id, new_status) in statuses {
        let mod_rc = match mod_manager.get_mod(&id) {
            Some(m) => m,
            None => {
                error!("Mod with ID {id} did not exist");
                continue;
            }
        };

        let already_installed = mod_rc.borrow().installed();
        if new_status && !already_installed {
            match mod_manager.install_mod(&id) {
                Ok(_) => info!("Installed {id}"),
                Err(err) => error!("Failed to install {id}: {err}")
            }
        }   else if !new_status && already_installed {
            match mod_manager.uninstall_mod(&id) {
                Ok(_) => info!("Uninstalled {id}"),
                Err(err) => error!("Failed to install {id}: {err}")
            }
        }
        
    }

    Ok(Response::Mods {
        installed_mods: get_mod_models(mod_manager),
    })
}

fn handle_get_mod_status() -> Result<Response> {
    info!("Loading installed mods");

    let mut mod_manager = ModManager::new();
    mod_manager.load_mods().context("Failed to load installed mods")?;

    info!("Searching for Beat Saber app");
    let app_info = get_app_info()?;
    let core_mods = match &app_info {
        Some(app_info) => get_core_mods_info(&app_info.version, &mod_manager)?,
        None => {
            warn!("Beat Saber is not installed!");
            None
        }
    };

    Ok(Response::ModStatus { 
        app_info,
        core_mods,
        modloader_present: patching::get_modloader_path()?.exists(),
        installed_mods: get_mod_models(mod_manager)
    })
}

fn get_mod_models(mod_manager: ModManager) -> Vec<ModModel> {
    mod_manager.get_mods()
        .map(|mod_info| ModModel::from(&*(**mod_info).borrow()))
        .collect()
}

fn get_core_mods_info(apk_version: &str, mod_manager: &ModManager) -> Result<Option<CoreModsInfo>> {
    // Fetch the core mods from the resources repo
    info!("Fetching core mod index");
    let core_mods = match crate::external_res::fetch_core_mods() {
        Ok(mods) => mods,
        Err(CoreModsError::FetchError(_)) => return Ok(None),
        Err(CoreModsError::ParseError(err)) => return Err(err)
    };

    // Check that all core mods are installed with an appropriate version
    let all_core_mods_installed = match core_mods.get(apk_version) {
        Some(core_mods) => core_mods.mods
            .iter()
            .all(|core_mod| match mod_manager.get_mod(&core_mod.id) {
                None => false,
                Some(installed_version) => {
                    let installed_ref = installed_version.borrow();
                    installed_ref.manifest().version >= core_mod.version && installed_ref.installed()
                }
            }),
        None => false
    };
    info!("All core mods installed: {}", all_core_mods_installed);

    let supported_versions: Vec<String> = core_mods.into_keys().filter(|version| {
        let mut iter = version.split('.');
        let _major = iter.next().unwrap();
        let _minor = iter.next().unwrap();

        _minor.parse::<i64>().expect("Invalid version in core mod index") >= 35
    }).collect();

    Ok(Some(CoreModsInfo {
        supported_versions,
        all_core_mods_installed
    }))
}

fn get_app_info() -> Result<Option<AppInfo>> {
    let apk_path = match crate::get_apk_path().context("Failed to find APK path")? {
        Some(path) => path,
        None => return Ok(None)
    };

    let apk_reader = std::fs::File::open(&apk_path)?;
    let mut apk = ZipFile::open(apk_reader).context("Failed to read APK as ZIP")?;

    let modloader = patching::get_modloader_installed(&mut apk)?;

    let manifest = apk.read_file("AndroidManifest.xml").context("Failed to read manifest")?;
    let mut manifest_reader = Cursor::new(manifest);

    let mut axml_reader = AxmlReader::new(&mut manifest_reader)?;
    let info = ManifestInfo::read(&mut axml_reader)?;

    Ok(Some(AppInfo {
        loader_installed: modloader,
        version: info.package_version,
        path: apk_path
    }))    
}

fn handle_import(from_path: String) -> Result<Response> {
    // Load the installed mods.
    let mut mod_manager = ModManager::new();
    mod_manager.load_mods()?;

    info!("Attempting to import from {from_path}");
    match mod_manager.try_load_new_mod(from_path.clone().into()) {
        Ok(id) => {
            // A bit of a hack here: when installing mods, 
            // we don't want to copy the unvalidated mod to the QMODs directory,
            // so we load it from a temporary directory.

            // If the mod loads successfully, we then need to *unload it* so that the file is not in use, then copy it to the mods directory.
            let new_path = mod_manager.get_unique_mod_path(&id);
            let installed_mods = get_mod_models(mod_manager); // Drops the mod_manager/the mod file handles

            // Copy to a new patch in the mods directory
            std::fs::copy(&from_path, new_path)?;
            std::fs::remove_file(from_path)?;

            Ok(Response::ImportedMod {
                imported_id: id,
                installed_mods
            })
        },
        Err(err) => {
            std::fs::remove_file(from_path)?;

            Err(err)
        }
    }
}

fn handle_remove_mod(id: String) -> Result<Response> {
    let mut mod_manager = ModManager::new();
    mod_manager.load_mods()?;
    mod_manager.remove_mod(&id)?;

    Ok(Response::Mods {
        installed_mods: get_mod_models(mod_manager)
    })
}

fn handle_quick_fix() -> Result<Response> {
    let app_info = get_app_info()?
        .ok_or(anyhow!("Cannot quick fix when app is not installed"))?;

    let mut mod_manager = ModManager::new();
    mod_manager.load_mods()?;

    // Reinstall missing core mods and overwrite the modloader with the one contained within the executable.
    install_core_mods(&mut mod_manager, app_info)?;
    patching::install_modloader()?;
    Ok(Response::Mods {
        installed_mods: get_mod_models(mod_manager)
    })
}

fn handle_patch() -> Result<Response> {
    let app_info = get_app_info()?
        .ok_or(anyhow!("Cannot patch when app not installed"))?;

    patching::mod_current_apk(&app_info).context("Failed to patch APK")?;
    patching::install_modloader().context("Failed to save modloader")?;

    let mut mod_manager = ModManager::new();
    info!("Wiping all existing mods");
    mod_manager.wipe_all_mods().context("Failed to wipe existing mods")?;
    mod_manager.load_mods()?; // Should load no mods.

    install_core_mods(&mut mod_manager, get_app_info()?
        .expect("Beat Saber should be installed after patching"))?;    

    Ok(Response::Mods { installed_mods: get_mod_models(mod_manager) })
}

fn install_core_mods(mod_manager: &mut ModManager, app_info: AppInfo) -> Result<()> {
    info!("Preparing core mods");
    let core_mod_index = crate::external_res::fetch_core_mods()?;

    let core_mods = core_mod_index.get(&app_info.version)
        .ok_or(anyhow!("No core mods existed for {}", app_info.version))?;


    for core_mod in &core_mods.mods {
        // Check if there is already an existing mod.
        match mod_manager.get_mod(&core_mod.id) {
            Some(existing) => {
                let existing_ref = existing.borrow();
                if existing_ref.manifest().version >= core_mod.version {
                    info!("Core mod {} was already installed with new enough version: {}", core_mod.id, existing_ref.manifest().version);
                    continue;
                }
            },
            None => {}
        }

        info!("Downloading {} v{}", core_mod.id, core_mod.version);
        let save_path = mod_manager.mods_path().as_ref()
            .join(format!("{}-v{}-CORE.qmod", core_mod.id, core_mod.version));

        download_file(&save_path, &core_mod.download_url).context("Failed to download core mod")?;
        mod_manager.try_load_new_mod(save_path)?;
        
    }

    info!("Installing core mods");
    mod_manager.load_mods().context("Failed to load core mods - is one invalid? If so, this is a BIG problem")?;
    for core_mod in &core_mods.mods {
        mod_manager.install_mod(&core_mod.id)?;
    }
    
    Ok(())
}