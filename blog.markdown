---
layout: index
title: "Muhammad Usman Akram"
---

<div class="content" id="page">
    <div class="container">
	    <div class="blog">
	        <h2>My Log</h2>
	        <ul>
	            <li>
	            <span>October 09, 2014</span> - <a href="https://gist.github.com/2f4cdd7cbf1791d735ad.git">GISTasEntry</a>
                </li>
	        {% for log in site.posts %}
	            <li>
	            <span>{{ log.date | date: "%B %e, %Y" }}</span> - <a href="{{ log.url }}">{{ log.title }}</a>
	            </li>
	        {% endfor %}
	        </ul>
	    </div>
      <hr class="featurette-divider">
    </div> <!-- /container -->
</div>