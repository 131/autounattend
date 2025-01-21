"use strict";

const fs = require('fs');
const path = require('path');
const {parse} = require('yaml');

const xml2js = require('xml2js');
const set = require('mout/object/set');
const get = require('mout/object/get');
const walk       = require('nyks/object/walk');
const jqdive     = require('nyks/object/jqdive');
const md5  = require('nyks/crypto/md5');
const pinfo = require('./package.json');
const deepMixIn = require('mout/object/deepMixIn');
const clone  = require('mout/lang/clone');


const promisify = require('nyks/function/promisify');
const parseString = promisify(xml2js.parseString);

const agent = `Build with ${pinfo.name} v${pinfo.version}`;

class autounattend {

  constructor(template_file, autodrive = "d:") {

    if(!fs.existsSync(template_file))
      throw `Invalid template file ${template_file}`;

    let body = fs.readFileSync(template_file, 'utf-8');
    this.template_name = path.basename(template_file, ".yml");
    console.log("Working with project '%s'", this.template_name);

    this.template  = parse(body);
    this.autodrive = autodrive;
  }

  _formatCommands(mode, commands, userdata) {
    if(!["host", "user"].includes(mode))
      throw `Invalid command mode ${mode}`;

    let cmds = [];

    for(let [order, command] of Object.entries(commands)) {
      let cmd = {
        $ : { "wcm:action" : "add" },
        Order : Number(order) + 1,
        //RequiresUserInput : true,
      };

      if(typeof command == "string") {
        command = {
          command,
          type : "cmd",
        };
      }

      let commandline = "";

      if(command.type == "cmd" || !command.type) {
        if(command.file) {
          let contents = fs.readFileSync(command.file, 'base64');
          let commands = [
            `Start-Transcript -Path 'C:/Automation/setup.txt' -append`,
            `$target = [System.IO.Path]::GetTempFileName() + ".cmd"`,
            `powershell "[IO.File]::WriteAllBytes('$target', [convert]::FromBase64String('${contents}'))"`,
            `cmd.exe /c $target`
          ];

          //continue to powershell wrapper
          command = {
            command     : commands.join(";"),
            description : `Running ${command.file}`,
            ...command,
            type : "powershell",
          };
        }

        commandline = command.command;
      }

      if(command.type == "powershell") {
        if(command.file) {
          command = {
            command     : fs.readFileSync(command.file),
            description : `Running ${command.file}`,
            ...command
          };
        }


        const complex = new RegExp("[\n{}]", "g");
        if(complex.test(command.command)) {
          command.description = `Running ${command.file} (inline)`;
          commandline = `powershell -encodedCommand "${Buffer.from(String(command.command), 'utf16le').toString('base64')}"`;
        } else {
          commandline = `powershell -Command "${command.command}"`;
        }

        if(commandline.length > 256) {
          command.description = `Running ${command.file} (external)`;
          const payload = Buffer.from(command.command).toString('base64');
          let uuid = md5(payload, true).toString('base64').replace(new RegExp("/", 'g')).substr(0, 6);
          // $drive=([System.IO.DriveInfo]::getdrives()  | Where-Object { Test-Path -Path ($_.Name+"\\autounattend.xml")} | Select-Object -first 1).Name; `, // "$drive\\autounattend.xml"
          // detecting autounatted.xml is possible but takes "too many" chars (even if the limit is supposed to be around 1k)
          // we use a constant instead
          // also, even base64 encoding makes everything too long ...
          // commandline = `powershell -encodedCommand "${Buffer.from(commandline, 'utf16le').toString('base64')}"`;
          // so we use plaintext
          commandline = `powershell -Command "iex ([Text.Encoding]::Utf8.GetString([Convert]::FromBase64String((Select-Xml -Path  'C:\\windows\\Panther\\unattend.xml' -XPath \\"//*[text()='${uuid}']/following-sibling::*\\").Node.InnerText)));"`;
          userdata[uuid] = payload;
        }
      }

      if(!commandline)
        continue;

      cmd.Description = command.description;
      if(mode == "user")
        cmd.CommandLine = commandline;
      if(mode == "host")
        cmd.Path = commandline;


      if(command.willreboot) {
        cmd.WillReboot = "Always";
      }

      cmds.push(cmd);
    }

    return cmds;
  }

  /*
      set(ShellSetup, "AutoLogon.Password.Value", get(this.template, "administrator.password"));
    set(ShellSetup, "UserAccounts.AdministratorPassword.Value", get(this.template, "administrator.password"));



    const oobeSystem = {
      $ : { pass : "oobeSystem" },
      component : [ShellSetup, { {
        ..._component("Security-Malware-Windows-Defender"),
        DisableAntiSpyware : true,
      },

      ],

    };




*/


  async generate() {

    var builder = new xml2js.Builder();
    const userdata = {};

    let fromDom = {};

    if(this.template.from) {
      let body = fs.readFileSync(this.template.from, 'utf8');
      fromDom = await  parseString(body);
    }

    if(this.template.base)
      fromDom = await  parseString(this.template.base);


    const metadata = {'xx:userdata' : []};


    let obj = clone(fromDom);

    obj = deepMixIn({
      unattend : {
        $ : {
          "xmlns"     : "urn:schemas-microsoft-com:unattend",
          "xmlns:wcm" : "http://schemas.microsoft.com/WMIConfig/2002/State",
          "xmlns:xsi" : "http://www.w3.org/2001/XMLSchema-instance",
          "xmlns:xx" :  "xtras",
        },
        'xx:metadata' : { $ : {agent}, ...metadata},
        servicing : { _ : ''},
        settings : [
        ],

      }
    }, obj);

    this.windowsPE = obj.unattend.settings.find(v => get(v, '$.pass')  == 'windowsPE');
    if(!this.windowsPE) {
      this.windowsPE = { $ : { pass : "windowsPE" },  component : [] };
      obj.unattend.settings.push(this.windowsPE);
    }
    this.windowsPESetup = this.windowsPE.component.find(v => get(v, '$.name') == 'Microsoft-Windows-Setup');

    this.specialize = obj.unattend.settings.find(v => get(v, '$.pass')  == 'specialize');
    if(!this.specialize) {
      this.specialize = { $ : { pass : "specialize" },  component : [] };
      obj.unattend.settings.push(this.specialize);
    }


    this.oobeSystem =  obj.unattend.settings.find(v => get(v, '$.pass')  == 'oobeSystem');
    if(!this.oobeSystem) {
      this.oobeSystem = { $ : { pass : "oobeSystem" },  component : [] };
      obj.unattend.settings.push(this.oobeSystem);
    }
    this.oobeShellSetup = this.oobeSystem.component.find(v => get(v, '$.name') == 'Microsoft-Windows-Shell-Setup');
    if(!this.oobeShellSetup) {
      this.oobeShellSetup = { ..._component("Microsoft-Windows-Shell-Setup") };
      this.oobeSystem.component.push(this.oobeShellSetup);
    }


    if(this.template.autologon || this.template.usercommands) {
      let {login, password} = this.template.autologon || {login : "Administrator", password : this.template.administrator.password};
      set(this.oobeShellSetup, "AutoLogon", {
        Enabled : true,
        Password : {
          Value : password,
          PlainText : true,
        },
        LogonCount : 10,
        Username : login,
      });
    }


    if(this.template.localaccount) {
      let {login, password} = this.template.localaccount;

      let localAcccount = get(this.oobeShellSetup, "UserAccounts.LocalAccounts.LocalAccount");
      if(!localAcccount) {
        localAcccount = [];
        set(this.oobeShellSetup, "UserAccounts.LocalAccounts.LocalAccount", localAcccount);
      }
      localAcccount.push({
        $ : { "wcm:action" : "add" },
        Password : {
          Value : password,
          PlainText : true,
        },
        Name : login,
        Group : 'Administrators',
        DisplayName : password
      });
    }

    if(get(this.template, "administrator.password"))
      set(this.oobeShellSetup, "UserAccounts.AdministratorPassword.Value", get(this.template, "administrator.password"));



    //classic
    set(this.oobeShellSetup, 'OOBE',  {
      HideEULAPage : true,
      NetworkLocation : "Work",
      HideLocalAccountScreen : true,
      HideOEMRegistrationScreen : true,
      HideOnlineAccountScreens : true,
      ProtectYourPC : 1,
      HideWirelessSetupInOOBE : true,
    });



    if(!this.windowsPESetup) {
      this.windowsPESetup = { ..._component("Microsoft-Windows-Setup")};
      this.windowsPE.component.push(this.windowsPESetup);
    }

    this.windowsPE.component.push(InternationalCore);


    if(!this.windowsPESetup.DiskConfiguration)
      set(this.windowsPESetup, 'DiskConfiguration', DiskConfiguration);

    const IMAGE_NAME = get(this.template, "windows.image");

    if(!this.windowsPESetup.ImageInstall && IMAGE_NAME) {
      const ImageInstall = {
        OSImage : {
          InstallFrom : {
            MetaData : [
              _metadata("/IMAGE/NAME", IMAGE_NAME)
            ],
          },
          InstallTo : {
            DiskID : 0,
            PartitionID : 4,
          },
          WillShowUI : "OnError",
          InstallToAvailablePartition : false,
        }
      };
      set(this.windowsPESetup, 'ImageInstall', ImageInstall);
    }

    set(this.windowsPESetup, 'UseConfigurationSet', true);


    if(!this.windowsPESetup.UserData)
      set(this.windowsPESetup, 'UserData', []);

    set(this.windowsPESetup, 'UserData.0.AcceptEula', true);


    this.spxdeployment = this.specialize.component.find(v => get(v, '$.name') == 'Microsoft-Windows-Deployment');
    if(!this.spxdeployment) {
      this.spxdeployment = { ..._component("Microsoft-Windows-Deployment") };
      this.specialize.component.push(this.spxdeployment);
    }

    this.spxshellSetup = this.specialize.component.find(v => get(v, '$.name') == 'Microsoft-Windows-Shell-Setup');
    if(!this.spxshellSetup) {
      this.spxshellSetup = { ..._component("Microsoft-Windows-Shell-Setup") };
      this.specialize.component.push(this.spxshellSetup);
    }

    if(get(this.template, "windows.product_key"))
      set(this.spxshellSetup, "ProductKey", get(this.template, "windows.product_key"));

    if(this.template.hostcommands) {
      let hostcommands = this._formatCommands('host', [
        ...POWERSHELL_UNLOCK_EXECUTION,
        ...(this.template.hostcommands  || [])
      ], userdata);

      set(this.spxdeployment, "RunSynchronous.RunSynchronousCommand", hostcommands);
    }

    if(this.template.locales) {
      let core = this.oobeSystem.component.find(v => get(v, '$.name') == 'Microsoft-Windows-International-Core');
      if(!core) {
        core = { ..._component("Microsoft-Windows-International-Core") };
        this.oobeSystem.component.push(core);
      }
      let {input, display} = this.template.locales;
      deepMixIn(core, {
        InputLocale : input,
        SystemLocale : display,
        UILanguage : display,
        UILanguageFallback : display,
        UserLocale : display,
      });
    }

    if(this.template.hostname) {
      if(this.template.hostname.length > 15)
        throw `hostname '${this.template.hostname}' is too long (15 chars max)`;

      set(this.spxshellSetup, "ComputerName", this.template.hostname);
    }


    if(this.template.usercommands) {
      let commands = [...this.template.usercommands];
      commands.push(`reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v AutoAdminLogon /d 0 /F`);

      commands = this._formatCommands('user', [
        ...POWERSHELL_UNLOCK_EXECUTION,
        ...commands
      ], userdata);

      set(this.oobeShellSetup, "FirstLogonCommands.SynchronousCommand", commands);
    }



    for(let [k, v] of Object.entries(userdata))
      metadata['xx:userdata'].push({ 'xx:key' : k, 'xx:value' : v});

    const hash = md5(JSON.stringify(obj));
    obj.unattend['xx:metadata']['$']['hash'] = hash;

    var xml = builder.buildObject(obj);

    console.log("Generated %s.xml with hash", this.template_name, hash);
    fs.writeFileSync(`${this.template_name}.xml`, xml);
  }
}


const POWERSHELL_UNLOCK_EXECUTION = [{
  description : "Set Execution Policy 64 Bit",
  type : "powershell",
  command : "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Force",
}, {
  description : "Set Execution Policy 32 Bit",
  command : `C:\\Windows\\SysWOW64\\cmd.exe /c powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Force"`,
}];


const _metadata = (Key, Value) => ({
  $ : { "wcm:action" : "add" },
  Key, Value
});

const _component = (name) => ({ $ : {
  name,
  "processorArchitecture" : "amd64",
  "publicKeyToken" : "31bf3856ad364e35",
  language : "neutral",
  versionScope : "nonSxS",
}});





const DiskConfiguration = {

  Disk : {
    $ : { "wcm:action" : "add" },
    DiskID : 0,
    WillWipeDisk  : true,
    CreatePartitions : {
      CreatePartition : [{
        // Recovery partition
        $ : { "wcm:action" : "add" },
        Order : 1,
        Type : "Primary",
        Size : 250,
      }, {
        // EFI system partition (ESP)
        $ : { "wcm:action" : "add" },
        Order : 2,
        Type : "EFI",
        Size : 100,
      }, {
        // Microsoft reserved partition (MSR)
        $ : { "wcm:action" : "add" },
        Order : 3,
        Type : "MSR",
        Size : 128,
      }, {
        // Windows partition
        $ : { "wcm:action" : "add" },
        Order : 4,
        Type : "Primary",
        Extend : true,
      }]
    },
    ModifyPartitions : {
      ModifyPartition : [{
        // Recovery partition
        $ : { "wcm:action" : "add" },
        Order : 1,
        PartitionID : 1,
        Label : "Recovery",
        Format : "NTFS",
        TypeID : "de94bba4-06d1-4d40-a16a-bfd50179d6ac",
      }, {
        // EFI system partition (ESP)
        $ : { "wcm:action" : "add" },
        Order : 2,
        PartitionID : 2,
        Label : "System",
        Format : "FAT32",
      }, {
        // Windows partition
        $ : { "wcm:action" : "add" },
        Order : 3,
        PartitionID : 4,
        Label : "Windows",
        Letter : "C",
        Format : "NTFS",
      },
      ]
    },
  },
  WillShowUI : "OnError",
};




const InternationalCore = {
  ..._component("Microsoft-Windows-International-Core-WinPE"),

  SetupUILanguage : {
    UILanguage : "en-US",
    WillShowUI : "OnError",
  },

  InputLocale : "040c:0000040c",
  SystemLocale : "en-US",
  UILanguage : "en-US",
  UILanguageFallback : "en-US",
  UserLocale : "en-US",
};



const replaceEnv = function(str, dict) {
  let mask = /(?:\$([a-z0-9._-]+))|(?:\$\$\{([^}]+)\})/i, match;
  if((match = mask.exec(str))) {
    const key = match[1] || match[2];
    let v = jqdive(dict, key);
    if(v !== undefined) {
      if(typeof v == "object")
        return v;
      return replaceEnv(str.replace(match[0], v), dict);
    }
  }
  return str;
};


module.exports = autounattend;
