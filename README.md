[autounattend](https://github.com/131/autounattend) is a CLI tool that help you build autounattend.xml files.


[![NPM version](https://img.shields.io/npm/v/autounattend.svg)](https://www.npmjs.com/package/autounattend)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](http://opensource.org/licenses/MIT)
[![Code style](https://img.shields.io/badge/code%2fstyle-ivs-green.svg)](https://www.npmjs.com/package/eslint-plugin-ivs)


# Motivation

Writing dynamic autounattend.xml files can be tedious. This tool simplifies the process by requiring you to write a meta, simplified `config.yml` file that describes your needs. Additionally, anything but trivial scripting might require external `ps1/cmd` scripts that have to be referenced from your autounattend.xml. However, depending on your provisioning pattern (e.g., USB stick / Terraform `cd_contents` provisioner), finding the "provisioning drive" can be a complex task.

The simplest macro, 
`$drive=([System.IO.DriveInfo]::getdrives()  | Where-Object { Test-Path -Path ($_.Name+"\\autounattend.xml")} | Select-Object -first 1).Name;`, can make every command line complex. Furthermore, I wanted to have standalone and portable `autounattended.xml` files.

This script inlines all external script files you might want to reference into base64-encoded metadata and makes them available directly in the autounattended.xml. The script will use a simple xml query introspecting lookup and Invoke-Expression. Therefore, the generated autounattended.xml file is portable and *stanalone*.

`config.yml` + scripts/folder => `cnyks autounattend` => :boom:*boom*:sparkles: standalone `autounattend.xml` :boom:*boom*:sparkles:


## Advanced 
You might want to use the `UseConfigurationSet` macro, which copies whatever file you have in your provisioning folder into a `%windows%` subfolder and makes it available behind the `%configurationset%` macro. Again, `autounattend.js` inlines any script you might want to use, so there should be no requirements for this.



# Usage
```
# Write config.yml file.(see syntax template below)
npm install -g cnyks autounattend

cnyks autounattend config.yml --ir://run=generate --ir://raw > autounattend.xml
# Enjoy
```

## Example configuration
```


```

# Credits
* [131](https://github.com/131)
