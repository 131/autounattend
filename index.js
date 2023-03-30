"use strict";

const fs = require('fs');
const yaml = require('yaml');

const promisify = require('nyks/function/promisify');
const xml2js = require('xml2js');




class autounattend {

  constructor(template) {

  }

  generate() {

    var builder = new xml2js.Builder();


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


const oobeSystem = {
  $ : { pass : "oobeSystem" },
  component : [ {
    ..._component("Microsoft-Windows-Shell-Setup"),

    AutoLogon : {
      Password : {
        Value : "ivs-ivs1234",
        PlainText : true,
      },
      Enabled : true,
      LogonCount : 10,
      Username : "Administrator",
    },
    FirstLogonCommands : {
      SynchronousCommand : [{
        $ : { "wcm:action" : "add" },
        Order : 1,
        RequiresUserInput : true,
        Description : "Set Execution Policy 64 Bit",
        CommandLine : `powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Force"`,
      }]
    },

    OOBE : {
      HideEULAPage : true,
      HideLocalAccountScreen : true,
      HideOEMRegistrationScreen : true,
      HideOnlineAccountScreens : true,
      ProtectYourPC : 1,
    },

    UserAccounts : {
      AdministratorPassword : {
        Value : "ivs-ivs1234",
        PlainText : true,
      }
    },

  }, {
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




const windowsPE = {
  $ : { pass : "windowsPE" },
  component : [ {
    ..._component("Microsoft-Windows-Setup"),
    DiskConfiguration,
    ImageInstall,
    UserData : {
      ProductKey : {
        Key : process.env.PRODUCT_KEY,
        WillShowUI : "OnError",
      },
      AcceptEula : true,
    },
  }, {

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
  } ]
};



module.exports = autounattend;
