import { Adb } from '@yume-chan/adb';
import { prepareAgent, runCommand } from "./Agent";
import { useEffect, useState } from 'react';
import { ModStatus } from './Messages';
import './DeviceModder.css';

interface DeviceModderProps {
    device: Adb
}

async function loadModStatus(device: Adb) {
    await prepareAgent(device);

    return await runCommand(device, {
        type: 'GetModStatus'
    }) as unknown as ModStatus;
}

async function patchApp(device: Adb) {
    await runCommand(device, {
        type: 'Patch'
    });
}

function DeviceModder(props: DeviceModderProps) {
    const [modStatus, setModStatus] = useState(null as ModStatus | null);
    const [isPatching, setIsPatching] = useState(false);

    useEffect(() => {
        loadModStatus(props.device).then(data => setModStatus(data));
    }, [props.device]);

    if(isPatching) {
        return <div className='container'>
            <h3>App is being patched.</h3>
            <p>This should only take a few seconds, but might take longer on a very slow connection.</p>
        </div>
    } else if(modStatus === null) {
        return <div className='container'>
            <h2>Pulling data from the Quest</h2>
        </div>;
    }   else if(modStatus.app_info === null) {
        return <div className='container'>
            <h1>Beat Saber is not installed</h1>
        </div>
    }   else if(!(modStatus.supported_versions.includes(modStatus.app_info.version))) {
        return <NotSupported version={modStatus.app_info.version} supportedVersions={modStatus.supported_versions}/>
    }   else if(modStatus.app_info.is_modded)   {
        return <div className='container'>
            <h1>App is modded</h1>
        </div>
    }   else    {
        return <PatchingMenu version={modStatus.app_info.version} onPatch={async () => {
            setIsPatching(true);
            try {
                await patchApp(props.device);
                modStatus.app_info!.is_modded = true;
                setModStatus(modStatus);
            }   finally {
                setIsPatching(false);
            }
        }}/>
    }
}

interface NotSupportedProps {
    version: string,
    supportedVersions: string[]
}

function NotSupported(props: NotSupportedProps) {
    return <div className='container'>
        <h1>Unsupported Version</h1>
        <p>You have Beat Saber v{props.version} installed, but this version has no support for mods!</p>
        <p>To install custom songs, one of the following versions is needed:</p>
        <ul>
            {props.supportedVersions.map(ver => <li>{ver}</li>)}
        </ul>
    </div>
}

interface PatchingMenuProps {
    version: string,
    onPatch: () => void
}

function PatchingMenu(props: PatchingMenuProps) {
    return <div className='container installSongs'>
        <h1>Install Custom Songs</h1>
        <p>Your app has version: {props.version}, which is supported by mods!</p>
        <p>To get your game ready for custom songs, ModsBeforeFriday will next patch your Beat Saber app and install some essential mods.
        Once this is done, you will be able to manage your custom songs <b>inside the game.</b></p>

        <h2 className='warning'>READ CAREFULLY</h2>
        <p>Mods and custom songs are not supported by Beat Games. You may experience bugs and crashes that you wouldn't in a vanilla game.</p>
        <b>In addition, by modding the game you will lose access to both vanilla leaderboards and vanilla multiplayer.</b> (Modded leaderboards/servers are available.)

        <button className="modButton" onClick={props.onPatch}>Mod the app</button>
    </div>
}


export default DeviceModder;