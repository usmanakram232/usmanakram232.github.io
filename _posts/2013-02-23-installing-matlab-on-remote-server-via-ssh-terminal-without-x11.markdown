---
layout: mylog
title: Installing matlab on Remote server via SSH/Terminal (without X11)
published: true
tags:
    - Matlab
---

##Matlab on Remote Linux Server without X11 and root Access

I will be explaining installation for acdemic use (as I needed to install it on our Lab Server and Acdemic access is what I get.)

Thing you will be needing:

-Valid key and activation file (getting activation file is explained.)
-Matlab (32bit is only supported uptill Matlab R2012a.)
-Remote access to Linux server (also valid forlocal machine.)

###Obtaining Activation File

-Creat Mathworks account, if you already do not hae one, using your university email address and selecting "Acdemic Use".
-Associate with the valid acdemic use key.
-Now go to "My Account -> Manage Licenses", select a key and go to "Activation and Installation" tab (for generating activation file: you will be needing hardware address (of eth0) of target machine.)
-Once you have provided required information (i.e hardware address, machine name, userid), just click on "Get License File" you will be able to download or email file  along with activation key.

###Obtaining Matlab
Now once again reach to "My Account" and proceed to "Get Licensed Products and Updates" under "My Download". Select you requireed version and download. 

###Instalation
Once you have obtained Matlab, just copy it to target machine. 
Edit installer_input file to provide Path key and other inputs and remember to add mode=silent, because unavailability of X11 will make installation to fail otherwise.

Also, edit activate.ini for activation information.

<code> ./install <br/>
cd $Matlab_PATH/bin<br/>
./activate_matlab.sh<br/>
alias matlab=$Matlab_PATH/bin/matlab<br/>
</code>

ta-da .... Now you have matlab, without using X11. Have fun.
