"use strict";

const fs = require('fs');
const {parse} = require('yaml');

const promisify = require('nyks/function/promisify');
const xml2js = require('xml2js');
const set = require('mout/object/set');
const get = require('mout/object/get');
const walk       = require('nyks/object/walk');
const jqdive     = require('nyks/object/jqdive');


class autounattend {

  constructor(template_file) {

    if(!fs.existsSync(template_file))
      throw `Invalid template file ${template_file}`;

    let body = fs.readFileSync(template_file, 'utf-8');
    let template  = parse(body);
    this.template = walk(template, v => replaceEnv(v, process.env));

    console.error(this.template);
  }

  _formatCommands(commands) {
    let cmds = [];

    for(let [order, command] of Object.entries(commands)) {

      if(typeof command == "string") 
        command = {
          command,
          type : "cmd",
        };

      let CommandLine = "";
      if(command.type == "cmd" || !command.type)
        CommandLine = command.command;
      if(command.type == "powershell") {
        if(command.file) {
          command = {
            command     : fs.readFileSync(command.file),
            description : `Running ${command.file}`,
            ...command
          };
        }

        const complex = new RegExp("\n", "g");
        if(complex.test(command.command)) {
          CommandLine = `powershell -encodedCommand "${Buffer.from(command.command).toString('base64')}"`;
        } else {
          CommandLine = `powershell -Command "${command.command}"`;
        }
      }

      if(!CommandLine)
        continue;

      let cmd = {
        $ : { "wcm:action" : "add" },
        Order : order,
        RequiresUserInput : true,
        Description : command.description,
        CommandLine,
      }
      cmds.push(cmd);
    }

    return cmds;
  }


  generate() {

    var builder = new xml2js.Builder();

    set(ShellSetup, "AutoLogon.Password.Value", get(this.template, "administrator.password"));
    set(ShellSetup, "UserAccounts.AdministratorPassword.Value", get(this.template, "administrator.password"));
    set(WinSetup, "UserData.ProductKey.Key", get(this.template, "windows.product_key"));

    let commands = this._formatCommands([ {
      description : "Set Execution Policy 64 Bit",
      type : "powershell_cmd",
      command : "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Force",
    }, {
      description : "Set Execution Policy 32 Bit",
      command : `C:\\Windows\\SysWOW64\\cmd.exe /c powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Force"`,
    }, ... (this.template.commands || [])]);


    set(ShellSetup, "FirstLogonCommands.SynchronousCommand", commands);


    const oobeSystem = {
      $ : { pass : "oobeSystem" },
      component : [ ShellSetup, {
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
      component : [ WinSetup, InternationalCore]
    };

    let obj = { 
      unattend: {
        $: {
          "xmlns"     : "urn:schemas-microsoft-com:unattend",
          "xmlns:wcm" : "http://schemas.microsoft.com/WMIConfig/2002/State",
          "xmlns:xsi" : "http://www.w3.org/2001/XMLSchema-instance"
        },

        servicing : { _:''},
        settings : [windowsPE, oobeSystem]

      }
    };  

    var xml = builder.buildObject(obj);
    return xml;
  }

}



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
      CreatePartition : [ {
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
      } , {
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
      } ]
    },
    ModifyPartitions : {
      ModifyPartition : [ {
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
      MetaData : {
        $ : { "wcm:action" : "add" },
        Key : "/IMAGE/NAME",
        Value : "Windows Server 2019 SERVERSTANDARDCORE",
      },
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
}



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
