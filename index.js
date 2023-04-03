"use strict";

const fs = require('fs');
const {parse} = require('yaml');

const xml2js = require('xml2js');
const set = require('mout/object/set');
const get = require('mout/object/get');
const walk       = require('nyks/object/walk');
const jqdive     = require('nyks/object/jqdive');
const md5  = require('nyks/crypto/md5');
const pinfo = require('./package.json');

class autounattend {

  constructor(template_file, autodrive = "d:") {

    if(!fs.existsSync(template_file))
      throw `Invalid template file ${template_file}`;

    let body = fs.readFileSync(template_file, 'utf-8');
    let template  = parse(body);
    this.template = walk(template, v => replaceEnv(v, process.env));
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
          let uuid = Buffer.from(md5(String(Math.random())), 'hex').toString('base64').replace(new RegExp("/", 'g')).substr(0, 6);
          // $drive=([System.IO.DriveInfo]::getdrives()  | Where-Object { Test-Path -Path ($_.Name+"\\autounattend.xml")} | Select-Object -first 1).Name; `, // "$drive\\autounattend.xml"
          // detecting autounatted.xml is possible but takes "too many" chars (even if the limit is supposed to be around 1k)
          // we use a constant instead
          // also, even base64 encoding makes everything too long ...
          // commandline = `powershell -encodedCommand "${Buffer.from(commandline, 'utf16le').toString('base64')}"`;
          // so we use plaintext
          commandline = `powershell -Command "iex ([Text.Encoding]::Utf8.GetString([Convert]::FromBase64String((Select-Xml -Path  'C:\\windows\\Panther\\unattend.xml' -XPath \\"//*[text()='${uuid}']/following-sibling::*\\").Node.InnerText)));"`;
          userdata[uuid] = Buffer.from(command.command).toString('base64');
        }
      }

      if(!commandline)
        continue;

      cmd.Description = command.description;
      if(mode == "user")
        cmd.CommandLine = commandline;
      if(mode == "host")
        cmd.Path = commandline;

      cmds.push(cmd);
    }

    return cmds;
  }


  generate() {

    var builder = new xml2js.Builder();
    const userdata = {};

    set(ShellSetup, "AutoLogon.Password.Value", get(this.template, "administrator.password"));
    set(ShellSetup, "UserAccounts.AdministratorPassword.Value", get(this.template, "administrator.password"));
    set(WinSetup, "UserData.ProductKey.Key", get(this.template, "windows.product_key"));

    let commands = this._formatCommands('user', [
      ...POWERSHELL_UNLOCK_EXECUTION,
      ...(this.template.usercommands  || [])
    ], userdata);

    set(ShellSetup, "FirstLogonCommands.SynchronousCommand", commands);


    const oobeSystem = {
      $ : { pass : "oobeSystem" },
      component : [ShellSetup, {
        ..._component("Microsoft-Windows-International-Core"),
        InputLocale : "040c:0000040c",
        SystemLocale : "en-US",
        UILanguage : "en-US",
        UILanguageFallback : "en-US",
        UserLocale : "en-US",
      }, {
        ..._component("Security-Malware-Windows-Defender"),
        DisableAntiSpyware : true,
      },

      ],

    };


    const windowsPE = {
      $ : { pass : "windowsPE" },
      component : [WinSetup, InternationalCore]
    };


    const spxdeployment = {
      ..._component("Microsoft-Windows-Deployment"),
    };

    const spxshellSetup = {
      ..._component("Microsoft-Windows-Shell-Setup"),
    };

    const specialize = {
      $ : { pass : "specialize" },
      component : [spxdeployment, spxshellSetup]
    };

    let hostcommands = this._formatCommands('host', [
      ...POWERSHELL_UNLOCK_EXECUTION,
      ...(this.template.hostcommands  || [])
    ], userdata);

    set(spxdeployment, "RunSynchronous.RunSynchronousCommand", hostcommands);

    if(this.template.hostname) {
      if(this.template.hostname.length > 15)
        throw `hostname '${this.template.hostname}' is too long (15 chars max)`;


      set(spxshellSetup, "ComputerName", this.template.hostname);
    }




    const metadata = {'xx:userdata' : []};

    for(let [k, v] of Object.entries(userdata))
      metadata['xx:userdata'].push({ 'xx:key' : k, 'xx:value' : v});

    let obj = {
      unattend : {
        $ : {
          "xmlns"     : "urn:schemas-microsoft-com:unattend",
          "xmlns:wcm" : "http://schemas.microsoft.com/WMIConfig/2002/State",
          "xmlns:xsi" : "http://www.w3.org/2001/XMLSchema-instance",
          "xmlns:xx" :  "xtras",
        },
        'xx:metadata' : { $ : {agent : `Build with ${pinfo.name} v${pinfo.version}`}, ...metadata},
        servicing : { _ : ''},
        settings : [
          windowsPE,
          specialize,
          oobeSystem
        ]

      }
    };

    var xml = builder.buildObject(obj);
    return xml;
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

const ShellSetup = {
  ..._component("Microsoft-Windows-Shell-Setup"),

  AutoLogon : {
    Password : {
      Value : false,
      PlainText : true,
    },
    Enabled : true,
    LogonCount : 10,
    Username : "Administrator",
  },
  FirstLogonCommands : {},

  OOBE : {
    HideEULAPage : true,
    HideLocalAccountScreen : true,
    HideOEMRegistrationScreen : true,
    HideOnlineAccountScreens : true,
    ProtectYourPC : 1,
  },

  UserAccounts : {
    AdministratorPassword : {
      Value : false,
      PlainText : true,
    }
  },

};





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

const ImageInstall = {
  OSImage : {
    InstallFrom : {
      MetaData : [
        _metadata("/IMAGE/NAME", "Windows Server 2019 SERVERSTANDARDCORE")
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


const WinSetup = {
  ..._component("Microsoft-Windows-Setup"),
  DiskConfiguration,
  ImageInstall,
  UseConfigurationSet : true,
  UserData : {
    ProductKey : {
      Key : false,
      WillShowUI : "OnError",
    },
    AcceptEula : true,
  },
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
