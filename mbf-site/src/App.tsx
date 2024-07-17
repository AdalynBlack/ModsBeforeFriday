import { useEffect, useRef, useState } from 'react';

import './css/App.css';
import { AdbDaemonWebUsbConnection, AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import { AdbDaemonTransport, Adb } from '@yume-chan/adb';

import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { DeviceModder } from './DeviceModder';
import { ErrorModal } from './components/Modal';
import { Bounce, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { CornerSourceLink, SmallSourceLink } from './components/SourceLink';
import { setCoreModOverrideUrl } from './Agent';

type NoDeviceCause = "NoDeviceSelected" | "DeviceInUse";

const MIN_SUPPORTED_ANDROID_VERSION: number = 11;

async function connect(
  setAuthing: () => void): Promise<Adb | NoDeviceCause> {
  const device_manager = new AdbDaemonWebUsbDeviceManager(navigator.usb);
  const quest = await device_manager.requestDevice();
  if(quest === undefined) {
    return "NoDeviceSelected";
  }

  let connection: AdbDaemonWebUsbConnection;
  try {
    connection = await quest.connect();
  } catch(err) {
    if(String(err).includes("Unable to claim interface")) {
      // Some other ADB daemon is hogging the connection, so we can't get to the Quest.
      return "DeviceInUse";
    } else  {
      throw err;
    }
  }
  const keyStore: AdbWebCredentialStore = new AdbWebCredentialStore("ModsBeforeFriday");

  setAuthing();
  const transport: AdbDaemonTransport = await AdbDaemonTransport.authenticate({
    serial: quest.serial,
    connection,
    credentialStore: keyStore
  });

  return new Adb(transport);
}

export async function getAndroidVersion(device: Adb) {
  const result = await device.subprocess.spawnAndWait("getprop ro.build.version.release");
  return Number(result.stdout.trim());
}

function ChooseDevice() {
  const [authing, setAuthing] = useState(false);
  const [chosenDevice, setChosenDevice] = useState(null as Adb | null);
  const [connectError, setConnectError] = useState(null as string | null);
  const [devicePreV51, setdevicePreV51] = useState(false);
  const [deviceInUse, setDeviceInUse] = useState(false);

  if(chosenDevice !== null) {
    console.log("Device model: " + chosenDevice.banner.model);
    if(chosenDevice.banner.model === "Quest") { // "Quest" not "Quest 2/3"
      return <div className='container mainContainer'>
        <h1>Quest 1 Not Supported</h1>
        <p>ModsBeforeFriday has detected that you're using a Quest 1, which is not supported by MBF. (and never will be)</p>
        <p>This is because Quest 1 uses different builds of the Beat Saber game and so mods are stuck forever on version 1.28.0 of the game.</p>
        <p>Follow <a href="https://bsmg.wiki/quest/modding-quest1.html">this link</a> for instructions on how to set up mods on Quest 1.</p>
      </div>
    } else if(devicePreV51 && chosenDevice.banner.model?.includes("Quest")) {
      return <div className="container mainContainer">
        <h1>Pre-v51 OS Detected</h1>
        <p>ModsBeforeFriday has detected that you have an outdated version of the Quest operating system installed which is no longer supported by mods.</p>
        <p>Please ensure your operating system is up to date and then refresh the page.</p>
      </div>
    } else  {
      return <>
        <DeviceModder device={chosenDevice} quit={(err) => {
          if(err != null) {
            setConnectError(String(err));
          }
          chosenDevice.close().catch(err => console.warn("Failed to close device " + err));
          setChosenDevice(null);
        }} />
      </>
    }
  } else if(authing) {
    return <div className='container mainContainer fadeIn'>
      <h2>Allow connection in headset</h2>
      <p>Put on your headset and click <b>"Always allow from this computer"</b></p>
      <p>(You should only have to do this once.)</p>
      <h4>Prompt doesn't show up?</h4>
      <ol>
        <li>Refresh the page.</li>
        <li>Put your headset <b>on your head</b>.</li>
        <li>Attempt to connect to your quest again.</li>
      </ol>
      <p>(Sometimes the quest only shows the prompt if the headset is on your head.)</p>
      <p>If these steps do not work, <b>reboot your quest and try once more.</b></p>
    </div>
  } else  {
    return <>
        <div className="container mainContainer">
          <Title />
          <p>To get started, plug your Quest in with a USB-C cable and click the button below.</p>

          <NoCompatibleDevices />

          <button id="chooseDevice" onClick={async () => {
            let device: Adb | null;

            try {
              const result = await connect(() => setAuthing(true));
              if(result === "NoDeviceSelected") {
                device = null;
              } else if(result === "DeviceInUse") {
                setDeviceInUse(true);
                return;
              } else  {
                device = result;
              }

            } catch(e) {
              console.log("Failed to connect: " + e);
              setConnectError(String(e));
              return;
            }
            
            if(device !== null) {
              const androidVersion = await getAndroidVersion(device);
              console.log("Device android version: " + androidVersion);
              setdevicePreV51(androidVersion < MIN_SUPPORTED_ANDROID_VERSION);
              setAuthing(false);
              setChosenDevice(device);

              await device.transport.disconnected;
              setChosenDevice(null);
            }
          }}>Connect to Quest</button>

          <ErrorModal isVisible={connectError != null}
            title="Failed to connect to device"
            description={connectError}
            onClose={() => setConnectError(null)}/>

          <ErrorModal isVisible={deviceInUse}
            onClose={() => setDeviceInUse(false)}
            title="Device in use">
              <DeviceInUse />
          </ErrorModal>
        </div>
      </>
  }
}

function DeviceInUse() {
 return <>
  <p>Some other app is trying to access your Quest, e.g. SideQuest.</p>
  {isViewingOnWindows() ? 
    <>
      <p>To fix this, close SideQuest if you have it open, press <span className="codeBox">Win + R</span> and type the following text, and finally press enter.</p>
      <span className="codeBox">taskkill /IM adb.exe /F</span>  
      <p>Alternatively, restart your computer.</p>
    </>
    : <p>To fix this, restart your {isViewingOnMobile() ? "phone" : "computer"}.</p>}
 </>
}

function Title() {
  return <>
    <h1>
      <span className="initial">M</span>
      <span className="title">ods</span>
      <span className="initial">B</span>
      <span className="title">efore</span>
      <span className="initial">F</span>
      <span className="title">riday</span>
      <span className="initial">!</span>
      <p className="williamGay">william gay</p>
    </h1>
    <SmallSourceLink />
    <p>The easiest way to install custom songs for Beat Saber on Quest!</p>
  </>
}

function ChooseCoreModUrl({ setSpecifiedCoreMods } : { setSpecifiedCoreMods: () => void}) {
  const inputFieldRef = useRef<HTMLInputElement | null>(null);

  return <div className='container mainContainer'>
    <h1>Manually override core mod JSON</h1>
    <p>Please specify a complete URL to the raw contents of your core mod JSON</p>
    <input type="text" ref={inputFieldRef}/>
    <br/><br/>
    <button onClick={() => {
      if(inputFieldRef.current !== null) {
        const inputField = inputFieldRef.current;
        console.warn("Overriding core mods URL to " + inputField.value)
        setCoreModOverrideUrl(inputField.value);
        const searchParams = new URLSearchParams(window.location.search);
        searchParams.set("setcores", inputField.value);
        window.history.replaceState({}, "ModsBeforeThursday", "?" + searchParams.toString());

        setSpecifiedCoreMods();
      }
    }}>
      Confirm URL
    </button>
  </div>
}

function AppContents() {
  const [ hasSetCoreUrl, setSetCoreUrl ] = useState(false);

  const overrideQueryParam: string | null = new URLSearchParams(window.location.search).get("setcores");
  let mustEnterUrl = false;
  if(overrideQueryParam !== "prompt" && overrideQueryParam !== null) {
    if(!hasSetCoreUrl) {
      console.warn("Setting core mod URL to " + overrideQueryParam);
      setCoreModOverrideUrl(overrideQueryParam);
      setSetCoreUrl(true);
    }
  } else if(overrideQueryParam !== null) {
    console.log("Prompting user to specify core mod URL");
    mustEnterUrl = true;
  }

  if (usingOculusBrowser()) {
    return <OculusBrowserMessage />
  } else  if (navigator.usb === undefined) {
    return <UnsupportedMessage />
  } else if (hasSetCoreUrl || !mustEnterUrl) {
    return <ChooseDevice />
  } else  {
    return <ChooseCoreModUrl setSpecifiedCoreMods={() => setSetCoreUrl(true)}/>
  }
}

function App() {
  return <div className='main'>
    <AppContents />
    <CornerSourceLink />
    <ToastContainer
      position="bottom-right"
      theme="dark"
      autoClose={5000}
      transition={Bounce}
      hideProgressBar={true} />
  </div>
}

function usingOculusBrowser(): boolean {
  return navigator.userAgent.includes("OculusBrowser");
}

function isViewingOnWindows(): boolean {
  // Deprecated but still works for our purposes.
  return navigator.appVersion.indexOf("Win") != -1;
}

function isViewingOnMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Kindly provided by Pierre
// https://stackoverflow.com/a/9039885
function isViewingOnIos() {
  return [
    'iPad Simulator',
    'iPhone Simulator',
    'iPod Simulator',
    'iPad',
    'iPhone',
    'iPod'
    // This is deprecated but still provides a good way to detect iOS as far as the author is concerned.
    // We are also doing feature detection for WebUSB, but detecting iOS provides a good way to warn the user that no iOS browsers will work with this app.
  ].includes(navigator.platform)
  // iPad on iOS 13 detection
  || (navigator.userAgent.includes("Mac") && "ontouchend" in document)
}

function OculusBrowserMessage() {
  return <div className="container mainContainer">
    <h1>Quest Browser Detected</h1>
    <p>MBF has detected that you're trying to use the built-in Quest browser.</p>
    <p>Unfortunately, <b>you cannot use MBF on the device you are attempting to mod.</b></p>
    <DevicesSupportingModding />

    <p>(MBF can be used on a Quest if you install a chromium browser, however this can only be used to mod <b>another Quest headset</b>, connected via USB.)</p>
  </div>
}

function UnsupportedMessage() {
  return <div className='container mainContainer'>
    {isViewingOnIos() ? <>
      <h1>iOS is not supported</h1>
      <p>MBF has detected that you're trying to use it from an iOS device. Unfortunately, Apple does not allow WebUSB, which MBF needs to be able to interact with the Quest.</p>
      <DevicesSupportingModding />

      <p>.... and one of the following supported browsers:</p>
    </> : <>
      <h1>Browser Unsupported</h1>
      <p>It looks like your browser doesn't support WebUSB, which this app needs to be able to access your Quest's files.</p>
    </>}

    <h2>Supported Browsers</h2>
    <SupportedBrowsers />
  </div>
}

function DevicesSupportingModding() {
  return <>
    <p>To mod your game, you will need one of: </p>
    <ul>
      <li>A PC or Mac (preferred)</li>
      <li>An Android phone (still totally works)</li>
    </ul>
  </>
}

function SupportedBrowsers() {
  if(isViewingOnMobile()) {
    return <>
      <ul>
        <li>Google Chrome for Android 122 or newer</li>
        <li>Edge for Android 123 or newer</li>
      </ul>
      <h3 className='fireFox'>Firefox for Android is NOT supported</h3>
    </>
  } else  {
    return <>
      <ul>
        <li>Google Chrome 61 or newer</li>
        <li>Opera 48 or newer</li>
        <li>Microsoft Edge 79 or newer</li>
      </ul>
      <h3 className='fireFox'>Firefox and Safari are NOT supported.</h3>
      <p>(There is no feasible way to add support for Firefox as Mozilla have chosen not to support WebUSB for security reasons.)</p>
    </>
  }
}

function NoCompatibleDevices() {
  return <>
    <h3>No compatible devices?</h3>

    <p>
      To use MBF, you must enable developer mode so that your Quest is accessible via USB.
      <br />Follow the <a href="https://developer.oculus.com/documentation/native/android/mobile-device-setup/?locale=en_GB" target="_blank" rel="noopener noreferrer">official guide</a> -
      you'll need to create a new organisation and enable USB debugging.
    </p>

    {isViewingOnMobile() && <>
      <h4>Using Android?</h4>
      <p>It's possible that the connection between your device and the Quest has been set up the wrong way around. To fix this:</p>
      <ul>
        <li>Swipe down from the top of the screen.</li>
        <li>Click the dialog relating to the USB connection. This might be called "charging via USB".</li>
        <li>Change "USB controlled by" to "Connected device". If "Connected device" is already selected, change it to "This device" and change it back.</li>
      </ul>
      <h4>Still not working?</h4>
      <p>Try unplugging your cable and plugging the end that's currently in your phone into your Quest.</p>
    </>}
  </>
}

export default App;
